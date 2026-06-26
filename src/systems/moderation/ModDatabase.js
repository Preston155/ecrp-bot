const crypto = require('node:crypto');
const { db } = require('../../database/db');

const statements = {
  config: db.prepare('SELECT * FROM moderation_config WHERE guild_id = ?'),
  ensureConfig: db.prepare('INSERT OR IGNORE INTO moderation_config (guild_id) VALUES (?)'),
  updateConfig: db.prepare(`
    UPDATE moderation_config SET
      mod_log_channel_id = COALESCE(@mod_log_channel_id, mod_log_channel_id),
      appeal_channel_id = COALESCE(@appeal_channel_id, appeal_channel_id),
      moderator_role_ids = COALESCE(@moderator_role_ids, moderator_role_ids),
      admin_role_ids = COALESCE(@admin_role_ids, admin_role_ids),
      dm_users_enabled = COALESCE(@dm_users_enabled, dm_users_enabled)
    WHERE guild_id = @guild_id
  `),
  sequence: db.prepare('SELECT next_number FROM moderation_sequences WHERE guild_id = ?'),
  createSequence: db.prepare('INSERT OR IGNORE INTO moderation_sequences (guild_id, next_number) VALUES (?, 1)'),
  advanceSequence: db.prepare('UPDATE moderation_sequences SET next_number = next_number + 1 WHERE guild_id = ?'),
  insertCase: db.prepare(`
    INSERT INTO moderation_cases (
      case_id, case_number, guild_id, user_id, user_tag_cached, moderator_id,
      moderator_tag_cached, action_type, reason, evidence_url, duration_ms,
      expires_at, created_at, updated_at, active, metadata
    ) VALUES (
      @case_id, @case_number, @guild_id, @user_id, @user_tag_cached, @moderator_id,
      @moderator_tag_cached, @action_type, @reason, @evidence_url, @duration_ms,
      @expires_at, @created_at, @updated_at, @active, @metadata
    )
  `),
  getCase: db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND UPPER(case_id) = UPPER(?)'),
  recentCases: db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'),
  updateReason: db.prepare('UPDATE moderation_cases SET reason = ?, updated_at = ? WHERE guild_id = ? AND UPPER(case_id) = UPPER(?)'),
  setLog: db.prepare('UPDATE moderation_cases SET message_id = ?, log_channel_id = ?, updated_at = ? WHERE case_id = ?'),
  closeCases: db.prepare(`
    UPDATE moderation_cases SET active = 0, removed = 1, removed_by = ?, removed_at = ?,
      removal_reason = ?, updated_at = ?
    WHERE guild_id = ? AND user_id = ? AND active = 1
  `),
  warning: db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND (UPPER(case_id) = UPPER(?) OR UPPER(warning_id) = UPPER(?))'),
  insertWarning: db.prepare(`
    INSERT INTO warnings (warning_id, case_id, guild_id, user_id, moderator_id, reason, created_at)
    VALUES (@warning_id, @case_id, @guild_id, @user_id, @moderator_id, @reason, @created_at)
  `),
  removeWarning: db.prepare(`
    UPDATE warnings SET active = 0, removed_by = ?, removed_at = ?, removal_reason = ?
    WHERE warning_id = ?
  `),
  markCaseRemoved: db.prepare(`
    UPDATE moderation_cases SET active = 0, removed = 1, removed_by = ?,
      removed_at = ?, removal_reason = ?, updated_at = ? WHERE case_id = ?
  `),
  insertPunishment: db.prepare(`
    INSERT INTO punishments (
      punishment_id, case_id, guild_id, user_id, type, duration_ms,
      expires_at, active, created_at
    ) VALUES (
      @punishment_id, @case_id, @guild_id, @user_id, @type, @duration_ms,
      @expires_at, 1, @created_at
    )
  `),
  activePunishments: db.prepare('SELECT * FROM punishments WHERE active = 1 AND expires_at IS NOT NULL ORDER BY expires_at ASC'),
  endPunishments: db.prepare(`
    UPDATE punishments SET active = 0, ended_at = ?, ended_by = ?, end_reason = ?
    WHERE guild_id = ? AND user_id = ? AND type IN (?, ?) AND active = 1
  `),
  endPunishment: db.prepare(`
    UPDATE punishments SET active = 0, ended_at = ?, ended_by = ?, end_reason = ?
    WHERE punishment_id = ?
  `),
  insertNote: db.prepare(`
    INSERT INTO moderation_notes (note_id, case_id, guild_id, user_id, moderator_id, note, created_at)
    VALUES (@note_id, @case_id, @guild_id, @user_id, @moderator_id, @note, @created_at)
  `),
  notes: db.prepare('SELECT * FROM moderation_notes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'),
};

function config(guildId) {
  statements.ensureConfig.run(guildId);
  const row = statements.config.get(guildId);
  return {
    ...row,
    moderator_role_ids: JSON.parse(row.moderator_role_ids || '[]'),
    admin_role_ids: JSON.parse(row.admin_role_ids || '[]'),
    dm_users_enabled: Boolean(row.dm_users_enabled),
    public_reason_enabled: Boolean(row.public_reason_enabled),
  };
}

const nextCaseNumber = db.transaction((guildId) => {
  statements.createSequence.run(guildId);
  const number = statements.sequence.get(guildId).next_number;
  statements.advanceSequence.run(guildId);
  return number;
});

function id(prefix = 'MOD') {
  return `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

module.exports = {
  config,
  updateConfig: (values) => {
    statements.ensureConfig.run(values.guild_id);
    statements.updateConfig.run(values);
    return config(values.guild_id);
  },
  nextCaseNumber,
  insertCase: (record) => statements.insertCase.run(record),
  getCase: (guildId, caseId) => statements.getCase.get(guildId, caseId),
  recentCases: (guildId, userId, limit = 15) => statements.recentCases.all(guildId, userId, limit),
  updateReason: (guildId, caseId, reason) => statements.updateReason.run(reason, Date.now(), guildId, caseId),
  setLog: (caseId, messageId, channelId) => statements.setLog.run(messageId, channelId, Date.now(), caseId),
  closeCases: (guildId, userId, actorId, reason) =>
    statements.closeCases.run(actorId, Date.now(), reason, Date.now(), guildId, userId),
  warning: (guildId, identifier) => statements.warning.get(guildId, identifier, identifier),
  insertWarning: (record) => statements.insertWarning.run(record),
  removeWarning: (warningId, actorId, reason) =>
    statements.removeWarning.run(actorId, Date.now(), reason, warningId),
  markCaseRemoved: (caseId, actorId, reason) =>
    statements.markCaseRemoved.run(actorId, Date.now(), reason, Date.now(), caseId),
  insertPunishment: (record) => statements.insertPunishment.run(record),
  activePunishments: () => statements.activePunishments.all(),
  endPunishments: (guildId, userId, types, actorId, reason) =>
    statements.endPunishments.run(Date.now(), actorId, reason, guildId, userId, types[0], types[1] || types[0]),
  endPunishment: (punishmentId, actorId, reason) =>
    statements.endPunishment.run(Date.now(), actorId, reason, punishmentId),
  insertNote: (record) => statements.insertNote.run(record),
  notes: (guildId, userId, limit = 10) => statements.notes.all(guildId, userId, limit),
  randomId: id,
};
