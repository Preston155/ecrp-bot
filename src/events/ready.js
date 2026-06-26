const { Events } = require('discord.js');
const scheduler = require('../systems/giveaways/GiveawayScheduler');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    return scheduler.start(client);
  },
};
