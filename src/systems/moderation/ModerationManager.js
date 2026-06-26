const { PermissionFlagsBits } = require('discord.js');
const resolver = require('./UserResolver');
const permissions = require('./ModerationPermissions');
const cases = require('./CaseManager');
const store = require('./ModDatabase');
const modLogger = require('./ModerationLogger');
const punishments = require('./PunishmentManager');
const { humanize } = require('./DurationParser');
const { logger } = require('../../utils/logger');

async function dmTarget(guild, target, record) {
  const config = store.config(guild.id);
  if (!config.dm_users_enabled || !target.user) return false;
  const appeal = config.appeal_channel_id ? `\nAppeals: <#${config.appeal_channel_id}>` : '';
  try {
    await target.user.send(
      `## Moderation Notice\n` +
      `**Server:** ${guild.name}\n` +
      `**Action:** ${record.action_type.replaceAll('_', ' ')}\n` +
      `**Reason:** ${record.reason}\n` +
      `**Duration:** ${record.duration_ms ? humanize(record.duration_ms) : 'N/A / Permanent'}\n` +
      `**Case:** \`${record.case_id}\`${appeal}`
    );
    return true;
  } catch {
    return false;
  }
}

async function createAndLog(interaction, target, action, reason, options = {}) {
  const record = cases.create({
    guild: interaction.guild,
    target,
    moderator: interaction.user,
    action,
    reason,
    evidenceUrl: options.evidenceUrl,
    durationMs: options.durationMs,
    expiresAt: options.expiresAt,
    active: options.active ?? true,
    metadata: options.metadata,
  });
  const dmSent = options.dm === false ? false : await dmTarget(interaction.guild, target, record);
  record.metadata = JSON.stringify({ ...(options.metadata || {}), dmSent });
  await modLogger.send(interaction.client, interaction.guild, record);
  logger.info('moderation_action', {
    caseId: record.case_id,
    action,
    guildId: interaction.guildId,
    userId: target?.userId,
    moderatorId: interaction.user.id,
    dmSent,
  });
  return record;
}

async function kick(interaction, target, reason, evidenceUrl) {
  permissions.requireHierarchy(interaction, target);
  if (!target.member) throw new Error('That user is not in this server.');
  if (!target.member.kickable) throw new Error('I cannot kick that member.');
  const record = await createAndLog(interaction, target, 'KICK', reason, { evidenceUrl });
  await target.member.kick(`${record.case_id}: ${reason}`);
  return record;
}

async function ban(interaction, target, reason, options = {}) {
  permissions.requireHierarchy(interaction, target);
  const action = options.durationMs ? 'TEMPBAN' : 'BAN';
  const record = await createAndLog(interaction, target, action, reason, options);
  await interaction.guild.members.ban(target.userId, {
    deleteMessageSeconds: Math.max(0, Math.min(7, options.deleteDays || 0)) * 86400,
    reason: `${record.case_id}: ${reason}`,
  });
  punishments.create(record, action);
  return record;
}

async function unban(interaction, target, reason) {
  await interaction.guild.bans.remove(target.userId, reason);
  punishments.clear(target.userId, interaction.guildId, ['BAN', 'TEMPBAN'], interaction.user.id, reason);
  return createAndLog(interaction, target, 'UNBAN', reason, { active: false });
}

async function warn(interaction, target, reason, evidenceUrl) {
  if (target.member) permissions.requireHierarchy(interaction, target);
  const record = await createAndLog(interaction, target, 'WARN', reason, { evidenceUrl });
  store.insertWarning({
    warning_id: store.randomId('WRN'),
    case_id: record.case_id,
    guild_id: interaction.guildId,
    user_id: target.userId,
    moderator_id: interaction.user.id,
    reason,
    created_at: Date.now(),
  });
  return record;
}

async function removeWarn(interaction, identifier, reason) {
  const warning = store.warning(interaction.guildId, identifier);
  if (!warning || !warning.active) throw new Error('Active warning not found.');
  store.removeWarning(warning.warning_id, interaction.user.id, reason);
  store.markCaseRemoved(warning.case_id, interaction.user.id, reason);
  const target = await resolver.resolve(interaction.client, interaction.guild, warning.user_id);
  return createAndLog(interaction, target, 'REMOVE_WARN', reason, {
    active: false,
    dm: false,
    metadata: { removedCaseId: warning.case_id, warningId: warning.warning_id },
  });
}

async function timeout(interaction, target, duration, reason, evidenceUrl) {
  permissions.requireHierarchy(interaction, target);
  if (!target.member) throw new Error('That user is not in this server.');
  const config = store.config(interaction.guildId);
  if (duration.milliseconds > config.max_timeout_duration_ms) {
    throw new Error('Timeout duration cannot exceed 28 days.');
  }
  if (!target.member.moderatable) throw new Error('I cannot timeout that member.');
  const record = await createAndLog(interaction, target, 'TIMEOUT', reason, {
    evidenceUrl,
    durationMs: duration.milliseconds,
    expiresAt: duration.expiresAt,
  });
  await target.member.timeout(duration.milliseconds, `${record.case_id}: ${reason}`);
  punishments.create(record, 'TIMEOUT');
  return record;
}

async function untimeout(interaction, target, reason) {
  permissions.requireHierarchy(interaction, target);
  if (!target.member) throw new Error('That user is not in this server.');
  await target.member.timeout(null, reason);
  punishments.clear(target.userId, interaction.guildId, ['TIMEOUT'], interaction.user.id, reason);
  return createAndLog(interaction, target, 'UNTIMEOUT', reason, { active: false });
}

async function softban(interaction, target, reason, deleteDays) {
  permissions.requireHierarchy(interaction, target);
  const record = await createAndLog(interaction, target, 'SOFTBAN', reason, { active: false });
  await interaction.guild.members.ban(target.userId, {
    deleteMessageSeconds: Math.max(0, Math.min(7, deleteDays || 1)) * 86400,
    reason: `${record.case_id}: ${reason}`,
  });
  await interaction.guild.bans.remove(target.userId, `Softban completed: ${record.case_id}`);
  return record;
}

async function channelAction(interaction, action, channel, reason, seconds = null) {
  if (action === 'LOCK') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason });
  } else if (action === 'UNLOCK') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, { reason });
  } else {
    await channel.setRateLimitPerUser(seconds, reason);
  }
  return createAndLog(interaction, null, action, reason, {
    active: false,
    dm: false,
    metadata: { channelId: channel.id, seconds },
  });
}

module.exports = {
  resolve: resolver.resolve,
  kick,
  ban,
  unban,
  warn,
  removeWarn,
  timeout,
  untimeout,
  softban,
  channelAction,
  createAndLog,
};
