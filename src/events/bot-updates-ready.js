const { Events } = require('discord.js');
const botUpdates = require('../systems/bot-updates-system');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    botUpdates.initialize(client);
  },
};
