const path = require('node:path');

function csv(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function integer(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

module.exports = Object.freeze({
  databasePath: path.join(__dirname, '..', '..', 'data', 'giveaways.sqlite'),
  managerRoleIds: csv(process.env.GIVEAWAY_MANAGER_ROLE_IDS),
  logChannelId: process.env.GIVEAWAY_LOG_CHANNEL_ID?.trim() || null,
  updateIntervalMs: Math.max(30, integer(process.env.GIVEAWAY_UPDATE_SECONDS, 45)) * 1000,
  defaultWinnerCount: Math.max(1, integer(process.env.GIVEAWAY_DEFAULT_WINNERS, 1)),
  maxActiveGiveaways: Math.max(1, integer(process.env.GIVEAWAY_MAX_ACTIVE, 20)),
  maxDurationMs: Math.max(1, integer(process.env.GIVEAWAY_MAX_DAYS, 30)) * 86_400_000,
  allowDuplicateWinners: process.env.GIVEAWAY_ALLOW_DUPLICATE_WINNERS === 'true',
  allowPreviousWinnersOnReroll: process.env.GIVEAWAY_ALLOW_PREVIOUS_REROLL === 'true',
  dmWinners: process.env.GIVEAWAY_DM_WINNERS === 'true',
});
