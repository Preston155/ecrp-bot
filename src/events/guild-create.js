const { Events } = require('discord.js');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildCreate,
  execute(guild) {
    logger.info('guild_joined', {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount,
    });
  },
};
