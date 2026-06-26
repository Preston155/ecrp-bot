const { Events } = require('discord.js');
const statusPanels = require('../systems/status/StatusPanelManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    return statusPanels.initialize(client);
  },
};
