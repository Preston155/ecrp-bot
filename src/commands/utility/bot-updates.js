const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const publicUpdates = new SlashCommandBuilder()
  .setName('bot-updates')
  .setDescription('View the latest ECRP Assistant features and improvements')
  .setDMPermission(false);

const staffUpdates = new SlashCommandBuilder()
  .setName('bot-updates-staff')
  .setDescription('View staff setup notes and commands for bot features')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

module.exports = { publicUpdates, staffUpdates };
