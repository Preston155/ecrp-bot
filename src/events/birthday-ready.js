const { Events } = require('discord.js');
const birthdays = require('../systems/birthdays/BirthdayManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    birthdays.initialize(client);
  },
};
