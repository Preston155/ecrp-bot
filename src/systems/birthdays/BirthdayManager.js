const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const database = require('../../database/db');
const { text } = require('../../utils/componentsV2');
const { logger } = require('../../utils/logger');

const CHECK_INTERVAL = 15 * 1000;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseBirthday(input) {
  const value = String(input || '').trim();
  let month;
  let day;

  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
  } else {
    const named = value.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
    if (named) {
      const query = named[1].toLowerCase();
      month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(query)) + 1;
      day = Number(named[2]);
    }
  }

  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('Use a valid birthday like `06/24` or `June 24`.');
  }

  const validation = new Date(Date.UTC(2024, month - 1, day));
  if (validation.getUTCMonth() !== month - 1 || validation.getUTCDate() !== day) {
    throw new Error('That calendar date is not valid.');
  }

  return { month, day };
}

function formatBirthday(month, day) {
  return `${MONTHS[month - 1]} ${day}`;
}

function zonedDate(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function nextOccurrence(month, day, timeZone) {
  const now = zonedDate(timeZone);
  let year = now.year;
  const todayKey = now.month * 100 + now.day;
  const birthdayKey = month * 100 + day;
  if (birthdayKey < todayKey) year += 1;
  return Math.floor(Date.UTC(year, month - 1, day, 13, 0, 0) / 1000);
}

class BirthdayManager {
  constructor() {
    this.client = null;
    this.interval = null;
    this.running = false;
  }

  initialize(client) {
    this.client = client;
    if (this.interval) clearInterval(this.interval);
    this.checkAll().catch((error) => logger.error('birthday_check_failed', error));
    this.interval = setInterval(() => {
      this.checkAll().catch((error) => logger.error('birthday_check_failed', error));
    }, CHECK_INTERVAL);
    this.interval.unref();
    logger.info('birthday_system_ready');
    for (const guild of client.guilds.cache.values()) {
      const config = database.birthdayConfig(guild.id);
      if (config.announcement_channel_id) {
        this.syncPanel(guild.id).catch((error) => {
          logger.warn('birthday_panel_recovery_failed', {
            guildId: guild.id,
            message: error.message,
          });
        });
      }
    }
  }

  async set(guildId, userId, input) {
    const birthday = parseBirthday(input);
    database.setBirthday(guildId, userId, birthday.month, birthday.day);
    await this.syncPanel(guildId);
    return birthday;
  }

  get(guildId, userId) {
    return database.getBirthday(guildId, userId);
  }

  async remove(guildId, userId) {
    const removed = database.removeBirthday(guildId, userId).changes > 0;
    if (removed) await this.syncPanel(guildId);
    return removed;
  }

  async setChannel(guildId, channelId) {
    const previous = database.birthdayPanel(guildId);
    if (previous?.message_id) {
      const previousChannel = await this.client.channels.fetch(previous.channel_id).catch(() => null);
      if (previousChannel?.isTextBased()) {
        const previousMessage = await previousChannel.messages.fetch(previous.message_id).catch(() => null);
        await previousMessage?.delete().catch(() => null);
      }
    }
    database.setBirthdayChannel(guildId, channelId);
    database.removeBirthdayPanel(guildId);
    await this.syncPanel(guildId);
  }

  upcoming(guildId, limit = 10) {
    const config = database.birthdayConfig(guildId);
    const now = zonedDate(config.timezone);
    const currentKey = now.month * 100 + now.day;
    return database.birthdaysForGuild(guildId)
      .map((birthday) => {
        const key = birthday.birth_month * 100 + birthday.birth_day;
        return { ...birthday, sortKey: key >= currentKey ? key : key + 1200 };
      })
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(0, limit);
  }

  profilePayload(userId, birthday, timeZone = 'America/New_York') {
    const timestamp = nextOccurrence(birthday.birth_month, birthday.birth_day, timeZone);
    const container = new ContainerBuilder()
      .setAccentColor(0xf472b6)
      .addTextDisplayComponents(text(
        `## 🎂 Birthday Profile\n` +
        `**Member:** <@${userId}>\n` +
        `**Birthday:** ${formatBirthday(birthday.birth_month, birthday.birth_day)}\n` +
        `**Next birthday:** <t:${timestamp}:R>\n` +
        `-# Birth year and age are never stored.`
      ));
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  upcomingPayload(guildId) {
    const birthdays = this.upcoming(guildId);
    const config = database.birthdayConfig(guildId);
    const lines = birthdays.length
      ? birthdays.map((birthday, index) =>
        `**${index + 1}.** <@${birthday.user_id}> • ` +
        `${formatBirthday(birthday.birth_month, birthday.birth_day)} • ` +
        `<t:${nextOccurrence(birthday.birth_month, birthday.birth_day, config.timezone)}:R>`
      )
      : ['No birthdays have been set yet.'];
    const container = new ContainerBuilder()
      .setAccentColor(0xf472b6)
      .addTextDisplayComponents(text(`## 🎈 Upcoming Birthdays\n${lines.join('\n')}`));
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  calendarPayload(guildId) {
    const config = database.birthdayConfig(guildId);
    const birthdays = database.birthdaysForGuild(guildId)
      .sort((a, b) =>
        (a.birth_month * 100 + a.birth_day) - (b.birth_month * 100 + b.birth_day)
      );
    const visible = birthdays.slice(0, 50);
    const lines = visible.length
      ? visible.map((birthday) =>
        `🎂 <@${birthday.user_id}> • **${formatBirthday(birthday.birth_month, birthday.birth_day)}** ` +
        `• <t:${nextOccurrence(birthday.birth_month, birthday.birth_day, config.timezone)}:R>`
      )
      : ['No birthdays have been added yet.', 'Use `-birthday set 06/24` to add yours.'];
    if (birthdays.length > visible.length) {
      lines.push(`-# Plus ${birthdays.length - visible.length} more birthdays.`);
    }

    const container = new ContainerBuilder()
      .setAccentColor(0xf472b6)
      .addTextDisplayComponents(text(
        `# 🎈 Birthday Calendar\n` +
        `Set your birthday and celebrate the community throughout the year.\n\n` +
        `${lines.join('\n')}\n\n` +
        `-# ${birthdays.length} birthday${birthdays.length === 1 ? '' : 's'} saved • Updates automatically`
      ));

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  async syncPanel(guildId) {
    if (!this.client?.isReady()) return null;
    const config = database.birthdayConfig(guildId);
    if (!config.announcement_channel_id) return null;

    const channel = await this.client.channels.fetch(config.announcement_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return null;
    const panel = database.birthdayPanel(guildId);
    const payload = this.calendarPayload(guildId);

    if (panel?.message_id) {
      const message = await channel.messages.fetch(panel.message_id).catch(() => null);
      if (message) {
        const editPayload = { ...payload };
        delete editPayload.flags;
        await message.edit(editPayload);
        return message;
      }
    }

    const message = await channel.send(payload);
    database.setBirthdayPanel(guildId, channel.id, message.id);
    logger.info('birthday_panel_created', {
      guildId,
      channelId: channel.id,
      messageId: message.id,
    });
    return message;
  }

  announcementPayload(member) {
    const avatar = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const container = new ContainerBuilder()
      .setAccentColor(0xf472b6)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(
            `# 🎉 Happy Birthday!\n` +
            `Everyone wish <@${member.id}> a happy birthday!\n\n` +
            `Hope your day is packed with good moments, good people, and a lot of cake. 🎂`
          ))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar))
      );
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: {
        users: [member.id],
        roles: [],
        parse: [],
        repliedUser: false,
      },
    };
  }

  async checkAll() {
    if (this.running || !this.client?.isReady()) return;
    this.running = true;
    try {
      for (const guild of this.client.guilds.cache.values()) {
        const config = database.birthdayConfig(guild.id);
        if (!config.announcement_channel_id) continue;
        const now = zonedDate(config.timezone);
        const birthdays = database.birthdaysOnDate(guild.id, now.month, now.day);
        if (!birthdays.length) continue;
        const channel = await guild.channels.fetch(config.announcement_channel_id).catch(() => null);
        if (!channel?.isTextBased()) continue;

        for (const birthday of birthdays) {
          if (birthday.last_announced_year === now.year) continue;
          const member = await guild.members.fetch(birthday.user_id).catch(() => null);
          if (!member) continue;
          const ping = await channel.send({
            content: `🎉 <@${member.id}> — your birthday has officially started!`,
            allowedMentions: { users: [member.id], roles: [], parse: [] },
          });
          await channel.send(this.announcementPayload(member));
          setTimeout(() => ping.delete().catch(() => null), 3000);
          database.markBirthdayAnnounced(guild.id, birthday.user_id, now.year);
          logger.info('birthday_announced', {
            guildId: guild.id,
            userId: birthday.user_id,
            channelId: channel.id,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

module.exports = new BirthdayManager();
module.exports.parseBirthday = parseBirthday;
module.exports.formatBirthday = formatBirthday;
