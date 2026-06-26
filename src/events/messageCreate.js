const { Events } = require('discord.js');
const database = require('../database/db');
const purge = require('../commands/moderation/purge');
const moderation = require('../commands/moderation/moderation-prefix');
const status = require('../commands/utility/status');
const birthday = require('../commands/utility/birthday');
const session = require('../commands/utility/session');
const counting = require('../systems/counting-system');
const tickets = require('../systems/ticket-system');
const botUpdates = require('../systems/bot-updates-system');
const developerLogs = require('../systems/developer-logs');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guildId || message.author.bot || message.webhookId) return;
    database.incrementMessages(message.guildId, message.author.id);

    const content = message.content.trim();

    if (content.toLowerCase() === '-botlogs' || content.toLowerCase().startsWith('-botlogs ')) {
      const argument = content.split(/\s+/)[1];
      await developerLogs.send(message, argument);
      return;
    }

    if (content.toLowerCase() === '-botupdates' || content.toLowerCase() === '-bot-updates') {
      if (!message.member.permissions.has('ManageGuild') &&
          !message.member.permissions.has('Administrator')) {
        await message.reply('You need Manage Server to post bot updates.');
        return;
      }
      await botUpdates.postPanel(message.channel);
      await message.delete().catch(() => null);
      return;
    }

    if (content.toLowerCase() === '-setsupport' || content.toLowerCase().startsWith('-setsupport ')) {
      if (!message.member.permissions.has('ManageGuild') &&
          !message.member.permissions.has('Administrator')) {
        await message.reply('You need Manage Server to configure the support role.');
        return;
      }
      const role = message.mentions.roles.first();
      if (!role) {
        await message.reply('Usage: `-setsupport @role`');
        return;
      }
      await tickets.setGuildChannel(message.guildId, 'support', role.id);
      await message.channel.send(`✅ **Ticket support role set to ${role}.** New tickets will ping this role.`);
      await message.delete().catch(() => null);
      return;
    }

    const ticketChannelCommands = {
      '-ticketrateset': 'rating',
      '-ticketlogset': 'log',
    };
    const ticketChannelCommand = ticketChannelCommands[content.split(/\s+/)[0].toLowerCase()];
    if (ticketChannelCommand) {
      if (!message.member.permissions.has('ManageGuild') &&
          !message.member.permissions.has('Administrator')) {
        await message.reply('You need Manage Server to configure ticket channels.');
        return;
      }
      const channel = message.mentions.channels.first();
      if (!channel?.isTextBased()) {
        await message.reply(`Usage: \`${content.split(/\s+/)[0]} #channel\``);
        return;
      }
      await tickets.setGuildChannel(message.guildId, ticketChannelCommand, channel.id);
      const label = ticketChannelCommand === 'rating' ? 'Ticket rating' : 'Ticket log';
      await message.channel.send(`✅ **${label} channel set to ${channel}.**`);
      await message.delete().catch(() => null);
      return;
    }

    if (content.toLowerCase() === '-ticket setup') {
      if (!message.member.permissions.has('ManageChannels') &&
          !message.member.permissions.has('Administrator')) {
        await message.reply('You need Manage Channels to set up the ticket panel.');
        return;
      }
      await tickets.sendTicketPanel(message.channel);
      await message.delete().catch(() => null);
      return;
    }

    if (content.toLowerCase() === '-counting' ||
        content.toLowerCase().startsWith('-counting ')) {
      const args = content.slice('-counting'.length).trim().split(/\s+/).filter(Boolean);
      try {
        await counting.prefixCommand(message, args);
      } catch (error) {
        console.error('Counting setup error:', error);
        await message.channel.send('There was an error setting up counting.');
      }
      return;
    }

    const handledCounting = await counting.handleMessage(message).catch((error) => {
      console.error('Counting message error:', error);
      return false;
    });
    if (handledCounting) return;
    if (content.toLowerCase() === '-status') {
      await status.execute(message);
      return;
    }

    if (content.toLowerCase() === '-birthday' ||
        content.toLowerCase().startsWith('-birthday ')) {
      const args = content.slice('-birthday'.length).trim().split(/\s+/).filter(Boolean);
      try {
        await birthday.execute(message, args);
      } catch (error) {
        const reply = await message.channel.send({
          content: error.message || 'The birthday command failed.',
          allowedMentions: { parse: [] },
        });
        setTimeout(() => reply.delete().catch(() => null), 7000);
      }
      return;
    }

    const sessionAliases = {
      '-sv': 'vote',
      '-ss': 'start',
      '-se': 'end',
    };
    const firstWord = content.split(/\s+/)[0].toLowerCase();
    if (sessionAliases[firstWord] || firstWord === '-session') {
      const parts = content.split(/\s+/);
      const action = sessionAliases[firstWord] || parts[1] || 'help';
      const sessionArgs = sessionAliases[firstWord] ? parts.slice(1) : parts.slice(2);
      try {
        await session.execute(message, action, sessionArgs);
      } catch (error) {
        const reply = await message.channel.send(
          require('../systems/sessions/SessionManager').noticePayload(
            '❌ Session Error',
            error.message || 'The session command failed.',
            0xef4444
          )
        );
        setTimeout(() => reply.delete().catch(() => null), 7000);
      }
      return;
    }

    if (content.startsWith('-')) {
      const [name, ...args] = content.slice(1).trim().split(/\s+/);
      if (name && moderation.commands.has(name.toLowerCase())) {
        try {
          await moderation.execute(message, name, args);
        } catch (error) {
          const reply = await message.channel.send({
            content: error.message || 'The moderation command failed.',
            allowedMentions: { parse: [] },
          });
          setTimeout(() => reply.delete().catch(() => null), 7000);
        }
        return;
      }
    }

    if (!content.toLowerCase().startsWith('-purge')) return;

    const [command, ...args] = content.split(/\s+/);
    if (command.toLowerCase() !== '-purge') return;
    await purge.execute(message, args);
  },
};
