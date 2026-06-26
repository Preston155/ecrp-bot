const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../systems/giveaways/GiveawayConfig');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const statements = {
  insertGiveaway: db.prepare(`
    INSERT INTO giveaways (
      id, guild_id, channel_id, prize, description, host_id, host_name,
      sponsor_id, winner_count, image_url, status, start_time, end_time,
      created_by, created_at
    ) VALUES (
      @id, @guild_id, @channel_id, @prize, @description, @host_id, @host_name,
      @sponsor_id, @winner_count, @image_url, 'active', @start_time, @end_time,
      @created_by, @created_at
    )
  `),
  insertRequirements: db.prepare(`
    INSERT INTO giveaway_requirements (
      giveaway_id, required_role_id, bonus_role_id, bonus_entries,
      blacklisted_role_id, allowed_role_ids, minimum_account_age_ms,
      minimum_join_age_ms, required_messages, booster_only
    ) VALUES (
      @giveaway_id, @required_role_id, @bonus_role_id, @bonus_entries,
      @blacklisted_role_id, @allowed_role_ids, @minimum_account_age_ms,
      @minimum_join_age_ms, @required_messages, @booster_only
    )
  `),
  getGiveaway: db.prepare(`
    SELECT g.*, r.required_role_id, r.bonus_role_id, r.bonus_entries,
      r.blacklisted_role_id, r.allowed_role_ids, r.minimum_account_age_ms,
      r.minimum_join_age_ms, r.required_messages, r.booster_only
    FROM giveaways g
    LEFT JOIN giveaway_requirements r ON r.giveaway_id = g.id
    WHERE g.id = ?
  `),
  getByMessage: db.prepare(`
    SELECT g.*, r.required_role_id, r.bonus_role_id, r.bonus_entries,
      r.blacklisted_role_id, r.allowed_role_ids, r.minimum_account_age_ms,
      r.minimum_join_age_ms, r.required_messages, r.booster_only
    FROM giveaways g
    LEFT JOIN giveaway_requirements r ON r.giveaway_id = g.id
    WHERE g.message_id = ?
  `),
  active: db.prepare(`
    SELECT g.*, r.required_role_id, r.bonus_role_id, r.bonus_entries,
      r.blacklisted_role_id, r.allowed_role_ids, r.minimum_account_age_ms,
      r.minimum_join_age_ms, r.required_messages, r.booster_only
    FROM giveaways g
    LEFT JOIN giveaway_requirements r ON r.giveaway_id = g.id
    WHERE g.status IN ('active', 'paused')
    ORDER BY g.end_time ASC
  `),
  activeByGuild: db.prepare(`
    SELECT * FROM giveaways
    WHERE guild_id = ? AND status IN ('active', 'paused')
    ORDER BY end_time ASC
  `),
  allByGuild: db.prepare(`
    SELECT * FROM giveaways
    WHERE guild_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  countActive: db.prepare(`
    SELECT COUNT(*) AS count FROM giveaways
    WHERE guild_id = ? AND status IN ('active', 'paused')
  `),
  setMessage: db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?'),
  addEntry: db.prepare(`
    INSERT INTO giveaway_entries (giveaway_id, user_id, weight, entered_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(giveaway_id, user_id)
    DO UPDATE SET weight = excluded.weight, entered_at = excluded.entered_at
  `),
  removeEntry: db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
  getEntry: db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
  entries: db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? ORDER BY entered_at ASC'),
  entryStats: db.prepare(`
    SELECT COUNT(*) AS users, COALESCE(SUM(weight), 0) AS weighted
    FROM giveaway_entries WHERE giveaway_id = ?
  `),
  winners: db.prepare('SELECT * FROM giveaway_winners WHERE giveaway_id = ? ORDER BY selected_at ASC'),
  addWinner: db.prepare(`
    INSERT INTO giveaway_winners (giveaway_id, user_id, selected_at, reroll_number)
    VALUES (?, ?, ?, ?)
  `),
  maxReroll: db.prepare(`
    SELECT COALESCE(MAX(reroll_number), 0) AS number
    FROM giveaway_winners WHERE giveaway_id = ?
  `),
  end: db.prepare(`
    UPDATE giveaways SET status = 'ended', ended_at = ?, ended_by = ?, remaining_ms = NULL
    WHERE id = ?
  `),
  cancel: db.prepare(`
    UPDATE giveaways SET status = 'cancelled', ended_at = ?, ended_by = ?
    WHERE id = ?
  `),
  pause: db.prepare(`
    UPDATE giveaways SET status = 'paused', remaining_ms = ? WHERE id = ?
  `),
  resume: db.prepare(`
    UPDATE giveaways SET status = 'active', end_time = ?, remaining_ms = NULL WHERE id = ?
  `),
  updateBasics: db.prepare(`
    UPDATE giveaways SET
      prize = COALESCE(@prize, prize),
      description = COALESCE(@description, description),
      winner_count = COALESCE(@winner_count, winner_count),
      end_time = COALESCE(@end_time, end_time),
      image_url = COALESCE(@image_url, image_url)
    WHERE id = @id
  `),
  updateRequirements: db.prepare(`
    UPDATE giveaway_requirements SET
      required_role_id = COALESCE(@required_role_id, required_role_id),
      bonus_role_id = COALESCE(@bonus_role_id, bonus_role_id),
      bonus_entries = COALESCE(@bonus_entries, bonus_entries),
      blacklisted_role_id = COALESCE(@blacklisted_role_id, blacklisted_role_id),
      allowed_role_ids = COALESCE(@allowed_role_ids, allowed_role_ids),
      minimum_account_age_ms = COALESCE(@minimum_account_age_ms, minimum_account_age_ms),
      minimum_join_age_ms = COALESCE(@minimum_join_age_ms, minimum_join_age_ms),
      required_messages = COALESCE(@required_messages, required_messages),
      booster_only = COALESCE(@booster_only, booster_only)
    WHERE giveaway_id = @giveaway_id
  `),
  log: db.prepare(`
    INSERT INTO giveaway_logs (giveaway_id, guild_id, user_id, action, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  addProof: db.prepare(`
    INSERT INTO giveaway_proofs (
      giveaway_id, guild_id, channel_id, message_id, submitted_by,
      image_url, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  incrementMessages: db.prepare(`
    INSERT INTO member_message_counts (guild_id, user_id, message_count)
    VALUES (?, ?, 1)
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET message_count = message_count + 1
  `),
  messageCount: db.prepare(`
    SELECT message_count FROM member_message_counts WHERE guild_id = ? AND user_id = ?
  `),
  addStatusPanel: db.prepare(`
    INSERT OR REPLACE INTO status_panels (message_id, guild_id, channel_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  statusPanels: db.prepare('SELECT * FROM status_panels ORDER BY created_at ASC'),
  removeStatusPanel: db.prepare('DELETE FROM status_panels WHERE message_id = ?'),
  setBirthday: db.prepare(`
    INSERT INTO birthdays (
      guild_id, user_id, birth_month, birth_day, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET
      birth_month = excluded.birth_month,
      birth_day = excluded.birth_day,
      updated_at = excluded.updated_at,
      last_announced_year = NULL
  `),
  getBirthday: db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  removeBirthday: db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?'),
  birthdaysForGuild: db.prepare('SELECT * FROM birthdays WHERE guild_id = ?'),
  birthdaysOnDate: db.prepare(`
    SELECT * FROM birthdays
    WHERE guild_id = ? AND birth_month = ? AND birth_day = ?
  `),
  markBirthdayAnnounced: db.prepare(`
    UPDATE birthdays SET last_announced_year = ?
    WHERE guild_id = ? AND user_id = ?
  `),
  ensureBirthdayConfig: db.prepare(`
    INSERT OR IGNORE INTO birthday_config (guild_id) VALUES (?)
  `),
  birthdayConfig: db.prepare('SELECT * FROM birthday_config WHERE guild_id = ?'),
  setBirthdayChannel: db.prepare(`
    INSERT INTO birthday_config (guild_id, announcement_channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET announcement_channel_id = excluded.announcement_channel_id
  `),
  birthdayPanel: db.prepare('SELECT * FROM birthday_panels WHERE guild_id = ?'),
  setBirthdayPanel: db.prepare(`
    INSERT INTO birthday_panels (guild_id, channel_id, message_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      updated_at = excluded.updated_at
  `),
  removeBirthdayPanel: db.prepare('DELETE FROM birthday_panels WHERE guild_id = ?'),
  ensureSessionConfig: db.prepare('INSERT OR IGNORE INTO session_config (guild_id) VALUES (?)'),
  sessionConfig: db.prepare('SELECT * FROM session_config WHERE guild_id = ?'),
  updateSessionConfig: db.prepare(`
    UPDATE session_config SET
      log_channel_id = COALESCE(@log_channel_id, log_channel_id),
      server_name = COALESCE(@server_name, server_name),
      game_code = COALESCE(@game_code, game_code),
      server_owner = COALESCE(@server_owner, server_owner),
      auto_start_count = COALESCE(@auto_start_count, auto_start_count)
    WHERE guild_id = @guild_id
  `),
  createSession: db.prepare(`
    INSERT INTO sessions (
      id, guild_id, channel_id, host_id, status, server_name, game_code,
      server_owner, auto_start_count, created_at
    ) VALUES (
      @id, @guild_id, @channel_id, @host_id, 'voting', @server_name, @game_code,
      @server_owner, @auto_start_count, @created_at
    )
  `),
  session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  activeSession: db.prepare(`
    SELECT * FROM sessions
    WHERE guild_id = ? AND status IN ('voting', 'active')
    ORDER BY created_at DESC LIMIT 1
  `),
  recentSessions: db.prepare(`
    SELECT * FROM sessions WHERE guild_id = ?
    ORDER BY created_at DESC LIMIT ?
  `),
  setSessionMessage: db.prepare('UPDATE sessions SET vote_message_id = ? WHERE id = ?'),
  setSessionStatus: db.prepare(`
    UPDATE sessions SET status = @status, started_at = COALESCE(@started_at, started_at),
      ended_at = COALESCE(@ended_at, ended_at), ended_by = COALESCE(@ended_by, ended_by)
    WHERE id = @id
  `),
  setSessionVote: db.prepare(`
    INSERT INTO session_votes (session_id, user_id, vote, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, user_id)
    DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at
  `),
  removeSessionVote: db.prepare('DELETE FROM session_votes WHERE session_id = ? AND user_id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  sessionVotes: db.prepare('SELECT * FROM session_votes WHERE session_id = ? ORDER BY updated_at ASC'),
  sessionVote: db.prepare('SELECT * FROM session_votes WHERE session_id = ? AND user_id = ?'),
  addAttendance: db.prepare(`
    INSERT OR IGNORE INTO session_attendance (session_id, user_id, source, recorded_at)
    VALUES (?, ?, ?, ?)
  `),
  sessionAttendance: db.prepare('SELECT * FROM session_attendance WHERE session_id = ? ORDER BY recorded_at ASC'),
  removeAttendance: db.prepare('DELETE FROM session_attendance WHERE session_id = ? AND user_id = ?'),
};

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    allowed_role_ids: JSON.parse(row.allowed_role_ids || '[]'),
    booster_only: Boolean(row.booster_only),
  };
}

const createGiveaway = db.transaction((giveaway, requirements) => {
  statements.insertGiveaway.run(giveaway);
  statements.insertRequirements.run(requirements);
});

module.exports = {
  db,
  createGiveaway,
  getGiveaway: (id) => hydrate(statements.getGiveaway.get(id)),
  getByMessage: (id) => hydrate(statements.getByMessage.get(id)),
  activeGiveaways: () => statements.active.all().map(hydrate),
  activeByGuild: (guildId) => statements.activeByGuild.all(guildId),
  allByGuild: (guildId, limit = 25) => statements.allByGuild.all(guildId, limit),
  countActive: (guildId) => statements.countActive.get(guildId).count,
  setMessage: (id, messageId) => statements.setMessage.run(messageId, id),
  addEntry: (id, userId, weight) => statements.addEntry.run(id, userId, weight, Date.now()),
  removeEntry: (id, userId) => statements.removeEntry.run(id, userId),
  getEntry: (id, userId) => statements.getEntry.get(id, userId),
  entries: (id) => statements.entries.all(id),
  entryStats: (id) => statements.entryStats.get(id),
  winners: (id) => statements.winners.all(id),
  addWinner: (id, userId, reroll) => statements.addWinner.run(id, userId, Date.now(), reroll),
  nextReroll: (id) => statements.maxReroll.get(id).number + 1,
  end: (id, actorId) => statements.end.run(Date.now(), actorId, id),
  cancel: (id, actorId) => statements.cancel.run(Date.now(), actorId, id),
  pause: (id, remaining) => statements.pause.run(remaining, id),
  resume: (id, endTime) => statements.resume.run(endTime, id),
  updateBasics: (changes) => statements.updateBasics.run(changes),
  updateRequirements: (changes) => statements.updateRequirements.run(changes),
  log: (id, guildId, userId, action, details = null) =>
    statements.log.run(id, guildId, userId, action, details ? JSON.stringify(details) : null, Date.now()),
  addProof: (record) => statements.addProof.run(
    record.giveawayId,
    record.guildId,
    record.channelId,
    record.messageId || null,
    record.submittedBy,
    record.imageUrl,
    record.note || null,
    Date.now()
  ),
  incrementMessages: (guildId, userId) => statements.incrementMessages.run(guildId, userId),
  messageCount: (guildId, userId) => statements.messageCount.get(guildId, userId)?.message_count || 0,
  addStatusPanel: (messageId, guildId, channelId, createdBy) =>
    statements.addStatusPanel.run(messageId, guildId, channelId, createdBy, Date.now()),
  statusPanels: () => statements.statusPanels.all(),
  removeStatusPanel: (messageId) => statements.removeStatusPanel.run(messageId),
  setBirthday: (guildId, userId, month, day) => {
    const now = Date.now();
    return statements.setBirthday.run(guildId, userId, month, day, now, now);
  },
  getBirthday: (guildId, userId) => statements.getBirthday.get(guildId, userId),
  removeBirthday: (guildId, userId) => statements.removeBirthday.run(guildId, userId),
  birthdaysForGuild: (guildId) => statements.birthdaysForGuild.all(guildId),
  birthdaysOnDate: (guildId, month, day) => statements.birthdaysOnDate.all(guildId, month, day),
  markBirthdayAnnounced: (guildId, userId, year) =>
    statements.markBirthdayAnnounced.run(year, guildId, userId),
  birthdayConfig: (guildId) => {
    statements.ensureBirthdayConfig.run(guildId);
    return statements.birthdayConfig.get(guildId);
  },
  setBirthdayChannel: (guildId, channelId) => statements.setBirthdayChannel.run(guildId, channelId),
  birthdayPanel: (guildId) => statements.birthdayPanel.get(guildId),
  setBirthdayPanel: (guildId, channelId, messageId) =>
    statements.setBirthdayPanel.run(guildId, channelId, messageId, Date.now()),
  removeBirthdayPanel: (guildId) => statements.removeBirthdayPanel.run(guildId),
  sessionConfig: (guildId) => {
    statements.ensureSessionConfig.run(guildId);
    return statements.sessionConfig.get(guildId);
  },
  updateSessionConfig: (values) => {
    statements.ensureSessionConfig.run(values.guild_id);
    statements.updateSessionConfig.run(values);
    return statements.sessionConfig.get(values.guild_id);
  },
  createSession: (record) => statements.createSession.run(record),
  session: (id) => statements.session.get(id),
  activeSession: (guildId) => statements.activeSession.get(guildId),
  recentSessions: (guildId, limit = 10) => statements.recentSessions.all(guildId, limit),
  setSessionMessage: (id, messageId) => statements.setSessionMessage.run(messageId, id),
  setSessionStatus: (values) => statements.setSessionStatus.run(values),
  setSessionVote: (sessionId, userId, vote) =>
    statements.setSessionVote.run(sessionId, userId, vote, Date.now()),
  removeSessionVote: (sessionId, userId) => statements.removeSessionVote.run(sessionId, userId),
  deleteSession: (sessionId) => statements.deleteSession.run(sessionId),
  sessionVotes: (sessionId) => statements.sessionVotes.all(sessionId),
  sessionVote: (sessionId, userId) => statements.sessionVote.get(sessionId, userId),
  addAttendance: (sessionId, userId, source = 'ready_vote') =>
    statements.addAttendance.run(sessionId, userId, source, Date.now()),
  sessionAttendance: (sessionId) => statements.sessionAttendance.all(sessionId),
  removeAttendance: (sessionId, userId) => statements.removeAttendance.run(sessionId, userId),
};
