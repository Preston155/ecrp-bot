const { Client, GatewayIntentBits, Partials } = require('discord.js');

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    allowedMentions: {
      parse: [],
      repliedUser: false,
    },
    failIfNotExists: false,
  });
}

module.exports = { createClient };
