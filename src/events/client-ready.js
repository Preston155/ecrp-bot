const { ActivityType, Events } = require('discord.js');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

const activityTypes = {
  Playing: ActivityType.Playing,
  Streaming: ActivityType.Streaming,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
  Custom: ActivityType.Custom,
};

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    client.user.setPresence({
      status: env.status,
      activities: env.activity
        ? [{ name: env.activity, type: activityTypes[env.activityType] }]
        : [],
    });

    logger.info('discord_ready', {
      user: client.user.tag,
      userId: client.user.id,
      guilds: client.guilds.cache.size,
    });
  },
};
