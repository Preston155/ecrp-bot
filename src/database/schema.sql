PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS giveaways (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  prize TEXT NOT NULL,
  description TEXT,
  host_id TEXT NOT NULL,
  host_name TEXT NOT NULL,
  sponsor_id TEXT,
  winner_count INTEGER NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  remaining_ms INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_giveaways_status_end
ON giveaways(status, end_time);

CREATE TABLE IF NOT EXISTS giveaway_requirements (
  giveaway_id TEXT PRIMARY KEY REFERENCES giveaways(id) ON DELETE CASCADE,
  required_role_id TEXT,
  bonus_role_id TEXT,
  bonus_entries INTEGER NOT NULL DEFAULT 0,
  blacklisted_role_id TEXT,
  allowed_role_ids TEXT NOT NULL DEFAULT '[]',
  minimum_account_age_ms INTEGER,
  minimum_join_age_ms INTEGER,
  required_messages INTEGER NOT NULL DEFAULT 0,
  booster_only INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  entered_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS giveaway_winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  selected_at INTEGER NOT NULL,
  reroll_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS giveaway_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id TEXT,
  guild_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaway_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  submitted_by TEXT NOT NULL,
  image_url TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_giveaway_proofs
ON giveaway_proofs(guild_id, giveaway_id, created_at DESC);

CREATE TABLE IF NOT EXISTS member_message_counts (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS status_panels (
  message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_sequences (
  guild_id TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS moderation_cases (
  case_id TEXT PRIMARY KEY,
  case_number INTEGER NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT,
  user_tag_cached TEXT,
  moderator_id TEXT NOT NULL,
  moderator_tag_cached TEXT NOT NULL,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_url TEXT,
  duration_ms INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  removed INTEGER NOT NULL DEFAULT 0,
  removed_by TEXT,
  removed_at INTEGER,
  removal_reason TEXT,
  message_id TEXT,
  log_channel_id TEXT,
  metadata TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_case_number
ON moderation_cases(guild_id, case_number);
CREATE INDEX IF NOT EXISTS idx_mod_cases_user
ON moderation_cases(guild_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS warnings (
  warning_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES moderation_cases(case_id),
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  removed_by TEXT,
  removed_at INTEGER,
  removal_reason TEXT
);

CREATE TABLE IF NOT EXISTS punishments (
  punishment_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES moderation_cases(case_id),
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_ms INTEGER,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_by TEXT,
  end_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_punishments_active
ON punishments(active, expires_at);

CREATE TABLE IF NOT EXISTS moderation_notes (
  note_id TEXT PRIMARY KEY,
  case_id TEXT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_config (
  guild_id TEXT PRIMARY KEY,
  mod_log_channel_id TEXT,
  appeal_channel_id TEXT,
  moderator_role_ids TEXT NOT NULL DEFAULT '[]',
  admin_role_ids TEXT NOT NULL DEFAULT '[]',
  mute_role_id TEXT,
  dm_users_enabled INTEGER NOT NULL DEFAULT 1,
  public_reason_enabled INTEGER NOT NULL DEFAULT 0,
  max_timeout_duration_ms INTEGER NOT NULL DEFAULT 2419200000
);

CREATE TABLE IF NOT EXISTS birthdays (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  birth_month INTEGER NOT NULL,
  birth_day INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_announced_year INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_birthdays_date
ON birthdays(guild_id, birth_month, birth_day);

CREATE TABLE IF NOT EXISTS birthday_config (
  guild_id TEXT PRIMARY KEY,
  announcement_channel_id TEXT,
  announcement_hour INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'America/New_York'
);

CREATE TABLE IF NOT EXISTS birthday_panels (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  vote_message_id TEXT,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'voting',
  server_name TEXT NOT NULL,
  game_code TEXT NOT NULL,
  server_owner TEXT NOT NULL,
  auto_start_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  ended_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_guild_status
ON sessions(guild_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS session_votes (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_attendance (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ready_vote',
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_config (
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT,
  server_name TEXT NOT NULL DEFAULT 'ERLC Roleplay',
  game_code TEXT NOT NULL DEFAULT 'ILCRPC',
  server_owner TEXT NOT NULL DEFAULT 'Liberty',
  auto_start_count INTEGER NOT NULL DEFAULT 1
);
