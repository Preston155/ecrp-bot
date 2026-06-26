const { Events } = require('discord.js');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildDelete,
  execute(guild) {
    logger.info('guild_left', {
      guildId: guild.id,
      guildName: guild.name,
    });
  },
};
