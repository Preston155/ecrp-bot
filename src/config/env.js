const validStatuses = new Set(['online', 'idle', 'dnd', 'invisible']);
const validActivityTypes = new Set([
  'Playing',
  'Streaming',
  'Listening',
  'Watching',
  'Competing',
  'Custom',
]);

function readInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) ? value : fallback;
}

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const status = process.env.BOT_STATUS?.trim().toLowerCase() || 'online';
const activityType = process.env.BOT_ACTIVITY_TYPE?.trim() || 'Watching';

const env = Object.freeze({
  discordToken: requireValue('DISCORD_TOKEN'),
  botName: process.env.BOT_NAME?.trim() || 'Bot4',
  status: validStatuses.has(status) ? status : 'online',
  activity: process.env.BOT_ACTIVITY?.trim() || 'Preparing something new',
  activityType: validActivityTypes.has(activityType) ? activityType : 'Watching',
  healthPort: readInteger('HEALTH_PORT', 3044),
  logLevel: process.env.LOG_LEVEL?.trim().toLowerCase() || 'info',
});

module.exports = { env };
