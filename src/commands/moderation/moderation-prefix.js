const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const manager = require('../../systems/moderation/ModerationManager');
const permissions = require('../../systems/moderation/ModerationPermissions');
const durationParser = require('../../systems/moderation/DurationParser');
const cases = require('../../systems/moderation/CaseManager');
const store = require('../../systems/moderation/ModDatabase');
const modLogger = require('../../systems/moderation/ModerationLogger');

const COMMANDS = new Set([
  'kick', 'ban', 'tempban', 'unban', 'uban', 'warn', 'removewarn', 'rwarn',
  'timeout', 'untimeout', 'utimeout', 'softban', 'case', 'cases', 'modlogs',
  'history', 'reason', 'note', 'lock', 'unlock', 'slowmode', 'massban',
  'clearhistory', 'appeal-info', 'appealinfo', 'modconfig',
]);

const ADMIN_COMMANDS = new Set([
  'ban', 'tempban', 'softban', 'unban', 'uban', 'massban', 'clearhistory',
]);

function context(message) {
  return {
    client: message.client,
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    channelId: message.channelId,
    user: message.author,
    member: message.member,
  };
}

function cleanTarget(value) {
  return String(value || '').replace(/[<@!>]/g, '');
}

function reason(args, start, fallback = null) {
  const value = args.slice(start).join(' ').trim();
  if (!value && !fallback) throw new Error('You must provide a reason.');
  return value || fallback;
}

function evidence(message) {
  return message.attachments.first()?.url || null;
}

async function temporaryReply(message, content, delay = 7000) {
  const reply = await message.channel.send({
    content,
    allowedMentions: { parse: [] },
  });
  setTimeout(() => reply.delete().catch(() => null), delay);
  return reply;
}

async function sendHistory(message, target) {
  const records = cases.recent(message.guildId, target.userId, 15);
  const notes = store.notes(message.guildId, target.userId, 5);
  const lines = records.length
    ? records.map((record) =>
      `\`${record.case_id}\` **${record.action_type.replaceAll('_', ' ')}** ` +
      `• ${record.active ? 'Active' : 'Closed'} • <t:${Math.floor(record.created_at / 1000)}:R>\n` +
      `${record.reason.slice(0, 180)}`
    )
    : ['No moderation cases found.'];
  if (notes.length) {
    lines.push('', '**Recent Notes**', ...notes.map((item) => `• ${item.note.slice(0, 180)}`));
  }
  await message.channel.send({
    content:
      `## Moderation History\n` +
      `**User:** <@${target.userId}> (\`${target.userId}\`)\n\n` +
      lines.join('\n'),
    allowedMentions: { parse: [] },
  });
}

async function configure(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Administrator is required to configure moderation.');
  }
  const subcommand = args[0]?.toLowerCase();
  const current = store.config(message.guildId);

  if (subcommand === 'view') {
    await message.channel.send({
      content: [
        `**Log Channel:** ${current.mod_log_channel_id ? `<#${current.mod_log_channel_id}>` : 'Not set'}`,
        `**Appeal Channel:** ${current.appeal_channel_id ? `<#${current.appeal_channel_id}>` : 'Not set'}`,
        `**Moderator Roles:** ${current.moderator_role_ids.length
          ? current.moderator_role_ids.map((id) => `<@&${id}>`).join(' ')
          : 'None'}`,
        `**DM Users:** ${current.dm_users_enabled ? 'Enabled' : 'Disabled'}`,
      ].join('\n'),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'setlog' || subcommand === 'setappeal') {
    const channelId = cleanTarget(args[1]);
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error('Mention a valid text channel.');
    store.updateConfig({
      guild_id: message.guildId,
      mod_log_channel_id: subcommand === 'setlog' ? channel.id : null,
      appeal_channel_id: subcommand === 'setappeal' ? channel.id : null,
      moderator_role_ids: null,
      admin_role_ids: null,
      dm_users_enabled: null,
    });
    await temporaryReply(
      message,
      subcommand === 'setlog'
        ? `Moderation logs will post in <#${channel.id}>.`
        : `Appeal channel set to <#${channel.id}>.`
    );
    return;
  }

  if (subcommand === 'addrole' || subcommand === 'removerole') {
    const roleId = cleanTarget(args[1]);
    const role = message.guild.roles.cache.get(roleId);
    if (!role) throw new Error('Mention a valid role.');
    const roles = new Set(current.moderator_role_ids);
    if (subcommand === 'addrole') roles.add(role.id);
    else roles.delete(role.id);
    store.updateConfig({
      guild_id: message.guildId,
      mod_log_channel_id: null,
      appeal_channel_id: null,
      moderator_role_ids: JSON.stringify([...roles]),
      admin_role_ids: null,
      dm_users_enabled: null,
    });
    await temporaryReply(message, `${subcommand === 'addrole' ? 'Added' : 'Removed'} <@&${role.id}>.`);
    return;
  }

  throw new Error('Use `-modconfig setlog #channel`, `setappeal #channel`, `addrole @role`, `removerole @role`, or `view`.');
}

async function execute(message, commandName, args) {
  const name = commandName.toLowerCase();
  if (!COMMANDS.has(name)) return false;

  const ctx = context(message);
  const level = ADMIN_COMMANDS.has(name)
    ? 'admin'
    : ['lock', 'unlock', 'slowmode'].includes(name)
      ? 'channels'
      : 'moderator';
  permissions.requireStaff(ctx, level);

  if (name === 'modconfig') {
    await configure(message, args);
    return true;
  }

  if (name === 'case') {
    const record = cases.get(message.guildId, args[0]);
    if (!record) throw new Error('Case not found in this server.');
    await message.channel.send(modLogger.casePayload(record, 'Moderation Case'));
    return true;
  }

  if (['cases', 'modlogs', 'history'].includes(name)) {
    const target = await manager.resolve(message.client, message.guild, cleanTarget(args[0]));
    await sendHistory(message, target);
    return true;
  }

  if (['appeal-info', 'appealinfo'].includes(name)) {
    const config = store.config(message.guildId);
    await temporaryReply(
      message,
      config.appeal_channel_id
        ? `Appeals are handled in <#${config.appeal_channel_id}>.`
        : 'No appeal channel has been configured.'
    );
    return true;
  }

  if (name === 'reason') {
    const caseId = args[0];
    const newReason = reason(args, 1);
    const original = cases.get(message.guildId, caseId);
    if (!original) throw new Error('Case not found.');
    cases.updateReason(message.guildId, caseId, newReason);
    await modLogger.update(message.client, cases.get(message.guildId, caseId));
    await temporaryReply(message, `Updated reason for \`${caseId}\`.`);
    return true;
  }

  if (['removewarn', 'rwarn'].includes(name)) {
    const record = await manager.removeWarn(ctx, args[0], reason(args, 1));
    await temporaryReply(message, `Warning removed. Case: \`${record.case_id}\``);
    return true;
  }

  if (['lock', 'unlock'].includes(name)) {
    const mentioned = message.mentions.channels.first();
    const channel = mentioned || message.channel;
    const reasonStart = mentioned ? 1 : 0;
    const record = await manager.channelAction(
      ctx,
      name.toUpperCase(),
      channel,
      reason(args, reasonStart, `Requested by ${message.author.tag}`)
    );
    await temporaryReply(message, `Channel ${name}ed. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'slowmode') {
    const seconds = Number.parseInt(args[0], 10);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
      throw new Error('Slowmode must be between 0 and 21600 seconds.');
    }
    const mentioned = message.mentions.channels.first();
    const channel = mentioned || message.channel;
    const record = await manager.channelAction(
      ctx,
      'SLOWMODE',
      channel,
      reason(args, mentioned ? 2 : 1, `Requested by ${message.author.tag}`),
      seconds
    );
    await temporaryReply(message, `Slowmode set to ${seconds}s. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'massban') {
    const separator = args.indexOf('--');
    if (separator < 1) throw new Error('Use `-massban ID,ID -- reason`.');
    const ids = [...new Set(args.slice(0, separator).join(' ').match(/\d{17,20}/g) || [])].slice(0, 25);
    const banReason = reason(args, separator + 1);
    let completed = 0;
    for (const id of ids) {
      const target = await manager.resolve(message.client, message.guild, id);
      await manager.ban(ctx, target, banReason);
      completed += 1;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await temporaryReply(message, `Banned ${completed}/${ids.length} users.`);
    return true;
  }

  const rawTarget = cleanTarget(args[0]);
  if (!rawTarget) throw new Error(`Use \`-${name} <user or ID> ...\`.`);
  const target = await manager.resolve(message.client, message.guild, rawTarget);

  if (name === 'kick') {
    const record = await manager.kick(ctx, target, reason(args, 1), evidence(message));
    await temporaryReply(message, `User kicked. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'warn') {
    const record = await manager.warn(ctx, target, reason(args, 1), evidence(message));
    await temporaryReply(message, `User warned. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'timeout') {
    const duration = durationParser.parse(args[1]);
    const record = await manager.timeout(ctx, target, duration, reason(args, 2), evidence(message));
    await temporaryReply(message, `User timed out. Case: \`${record.case_id}\``);
    return true;
  }

  if (['untimeout', 'utimeout'].includes(name)) {
    const record = await manager.untimeout(ctx, target, reason(args, 1));
    await temporaryReply(message, `Timeout removed. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'ban') {
    const record = await manager.ban(ctx, target, reason(args, 1), {
      evidenceUrl: evidence(message),
    });
    await temporaryReply(message, `User banned. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'tempban') {
    const duration = durationParser.parse(args[1]);
    const record = await manager.ban(ctx, target, reason(args, 2), {
      evidenceUrl: evidence(message),
      durationMs: duration.milliseconds,
      expiresAt: duration.expiresAt,
    });
    await temporaryReply(message, `User temporarily banned. Case: \`${record.case_id}\``);
    return true;
  }

  if (['unban', 'uban'].includes(name)) {
    const record = await manager.unban(ctx, target, reason(args, 1));
    await temporaryReply(message, `User unbanned. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'softban') {
    const record = await manager.softban(ctx, target, reason(args, 1), 1);
    await temporaryReply(message, `User softbanned. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'note') {
    const noteText = reason(args, 1);
    const noteId = store.randomId('NOTE');
    store.insertNote({
      note_id: noteId,
      case_id: null,
      guild_id: message.guildId,
      user_id: target.userId,
      moderator_id: message.author.id,
      note: noteText,
      created_at: Date.now(),
    });
    const record = await manager.createAndLog(ctx, target, 'NOTE', noteText, {
      active: false,
      dm: false,
      metadata: { noteId },
    });
    await temporaryReply(message, `Note added. Case: \`${record.case_id}\``);
    return true;
  }

  if (name === 'clearhistory') {
    const clearReason = reason(args, 1);
    store.closeCases(message.guildId, target.userId, message.author.id, clearReason);
    const record = await manager.createAndLog(ctx, target, 'CLEAR_HISTORY', clearReason, {
      active: false,
      dm: false,
    });
    await temporaryReply(message, `History archived. Case: \`${record.case_id}\``);
    return true;
  }

  return false;
}

module.exports = { execute, commands: COMMANDS };
