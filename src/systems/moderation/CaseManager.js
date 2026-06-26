const store = require('./ModDatabase');

const PREFIXES = {
  BAN: 'BAN',
  TEMPBAN: 'BAN',
  UNBAN: 'UNBAN',
  WARN: 'WARN',
  REMOVE_WARN: 'RWARN',
  KICK: 'KICK',
  TIMEOUT: 'TIME',
  UNTIMEOUT: 'UTIME',
  SOFTBAN: 'SOFT',
  PURGE: 'PURGE',
  LOCK: 'LOCK',
  UNLOCK: 'UNLOCK',
  SLOWMODE: 'SLOW',
  NOTE: 'NOTE',
  CLEAR_HISTORY: 'CLEAR',
};

function create({ guild, target, moderator, action, reason, evidenceUrl, durationMs, expiresAt, active = true, metadata }) {
  const number = store.nextCaseNumber(guild.id);
  const prefix = PREFIXES[action] || 'MOD';
  const caseId = `${prefix}-${String(number).padStart(6, '0')}`;
  const now = Date.now();
  const record = {
    case_id: caseId,
    case_number: number,
    guild_id: guild.id,
    user_id: target?.userId || null,
    user_tag_cached: target?.tag || null,
    moderator_id: moderator.id,
    moderator_tag_cached: moderator.tag || moderator.username,
    action_type: action,
    reason,
    evidence_url: evidenceUrl || null,
    duration_ms: durationMs || null,
    expires_at: expiresAt || null,
    created_at: now,
    updated_at: now,
    active: active ? 1 : 0,
    metadata: metadata ? JSON.stringify(metadata) : null,
  };
  store.insertCase(record);
  return record;
}

module.exports = {
  create,
  get: store.getCase,
  recent: store.recentCases,
  updateReason: store.updateReason,
};
