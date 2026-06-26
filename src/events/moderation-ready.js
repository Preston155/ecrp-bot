const { Events } = require('discord.js');
const punishments = require('../systems/moderation/PunishmentManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    return punishments.initialize(client);
  },
};
