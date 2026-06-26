const { Events } = require('discord.js');
const sessions = require('../systems/sessions/SessionManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    sessions.initialize(client);
  },
};
