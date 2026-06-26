const { Events } = require('discord.js');
const tickets = require('../systems/ticket-system');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    return tickets.initialize(client);
  },
};
