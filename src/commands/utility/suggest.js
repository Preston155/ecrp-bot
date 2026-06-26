const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit a suggestion in this channel')
    .addStringOption((option) => option
      .setName('suggestion')
      .setDescription('What would you like to suggest?')
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(1000)),
};
