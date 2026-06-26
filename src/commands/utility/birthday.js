const { PermissionFlagsBits } = require('discord.js');
const birthdays = require('../../systems/birthdays/BirthdayManager');
const database = require('../../database/db');

async function execute(message, args) {
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === 'set') {
    const input = args.slice(1).join(' ');
    if (!input) throw new Error('Use `-birthday set 06/24` or `-birthday set June 24`.');
    const birthday = await birthdays.set(message.guildId, message.author.id, input);
    const config = database.birthdayConfig(message.guildId);
    await message.channel.send(birthdays.profilePayload(message.author.id, {
      birth_month: birthday.month,
      birth_day: birthday.day,
    }, config.timezone));
    return;
  }

  if (subcommand === 'remove' || subcommand === 'delete') {
    const removed = await birthdays.remove(message.guildId, message.author.id);
    const reply = await message.channel.send(
      removed ? 'Your birthday has been removed.' : 'You do not have a birthday set.'
    );
    setTimeout(() => reply.delete().catch(() => null), 5000);
    return;
  }

  if (subcommand === 'list' || subcommand === 'upcoming') {
    await message.channel.send(birthdays.upcomingPayload(message.guildId));
    return;
  }

  if (subcommand === 'setup') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new Error('You need Manage Server to configure birthday announcements.');
    }
    const channel = message.mentions.channels.first();
    if (!channel?.isTextBased()) throw new Error('Use `-birthday setup #channel`.');
    await birthdays.setChannel(message.guildId, channel.id);
    const reply = await message.channel.send(`Birthday announcements will post in <#${channel.id}>.`);
    setTimeout(() => reply.delete().catch(() => null), 6000);
    return;
  }

  const target = message.mentions.users.first() || message.author;
  const birthday = birthdays.get(message.guildId, target.id);
  if (!birthday) {
    const self = target.id === message.author.id;
    const reply = await message.channel.send(
      self
        ? 'You have no birthday set. Use `-birthday set 06/24`.'
        : 'That member has no birthday set.'
    );
    setTimeout(() => reply.delete().catch(() => null), 6000);
    return;
  }
  const config = database.birthdayConfig(message.guildId);
  await message.channel.send(birthdays.profilePayload(target.id, birthday, config.timezone));
}

module.exports = { execute };
