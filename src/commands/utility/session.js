const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const sessions = require('../../systems/sessions/SessionManager');
const database = require('../../database/db');
const PREFIX = process.env.SESSION_PREFIX || '-';

function isStaff(message) {
  return message.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    message.member.permissions.has(PermissionFlagsBits.Administrator);
}

async function execute(message, action, args = []) {
  const command = (action || 'help').toLowerCase();
  const active = database.activeSession(message.guildId);

  if (command === 'help') {
    await message.channel.send(sessions.helpPayload(PREFIX));
    return;
  }

  if (command === 'status') {
    if (!active) throw new Error('There is no open session.');
    await message.channel.send(sessions.statusPayload(active));
    return;
  }

  if (command === 'roster' || command === 'list') {
    if (!active) throw new Error('There is no open session.');
    const payload = sessions.rosterPayload(active);
    payload.flags = MessageFlags.IsComponentsV2;
    await message.channel.send(payload);
    return;
  }

  if (command === 'history') {
    await message.channel.send(sessions.historyPayload(message.guildId));
    return;
  }

  if (!isStaff(message)) throw new Error('You need Manage Server to control sessions.');

  if (command === 'vote') {
    await sessions.create(message);
    return;
  }
  if (command === 'start') {
    await sessions.start(message.guildId, message.author.id, false);
    await message.delete().catch(() => null);
    return;
  }
  if (command === 'end') {
    await sessions.end(message.guildId, message.author.id);
    await message.delete().catch(() => null);
    return;
  }
  if (command === 'cancel') {
    await sessions.cancel(message.guildId, message.author.id);
    await message.delete().catch(() => null);
    return;
  }
  if (command === 'attendance') {
    const attendanceAction = (args[0] || '').toLowerCase();
    const member = message.mentions.members.first();
    if (!['add', 'remove'].includes(attendanceAction) || !member) {
      throw new Error(`Usage: \`${PREFIX}session attendance add/remove @member\``);
    }
    const attendance = await sessions.adjustAttendance(
      message.guildId, member.id, attendanceAction, message.author.id
    );
    await message.channel.send(sessions.noticePayload(
      attendanceAction === 'add' ? '✅ Attendance Added' : '➖ Attendance Removed',
      `<@${member.id}> was ${attendanceAction === 'add' ? 'added to' : 'removed from'} the active patrol.\n**Attendance:** ${attendance.length}`,
      attendanceAction === 'add' ? 0x22c55e : 0xf59e0b
    ));
    await message.delete().catch(() => null);
    return;
  }
  if (command === 'setup') {
    const channel = message.mentions.channels.first();
    const raw = args.join(' ').replace(/<#[0-9]+>/, '').trim();
    const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
    const autoStartCount = parts[3] ? Number.parseInt(parts[3], 10) : null;
    if (autoStartCount !== null &&
        (!Number.isInteger(autoStartCount) || autoStartCount < 1 || autoStartCount > 100)) {
      throw new Error('Auto-start count must be from 1 to 100.');
    }
    const config = sessions.updateConfig(message.guildId, {
      logChannelId: channel?.id,
      serverName: parts[0],
      gameCode: parts[1],
      serverOwner: parts[2],
      autoStartCount,
    });
    await message.channel.send(sessions.configPayload(config));
    return;
  }
  throw new Error(`Unknown session command. Use \`${PREFIX}session help\`.`);
}

module.exports = { execute };
