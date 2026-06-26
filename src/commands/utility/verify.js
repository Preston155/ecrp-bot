const { ChannelType, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your Roblox account with ECRP')
    .addSubcommand((sub) => sub
      .setName('start')
      .setDescription('Start Roblox verification')
      .addStringOption((option) => option
        .setName('username')
        .setDescription('Your Roblox username')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(20)))
    .addSubcommand((sub) => sub
      .setName('profile')
      .setDescription('View a verified Roblox profile')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Discord user to check')
        .setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('unlink')
      .setDescription('Remove your linked Roblox account'))
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Staff: configure ECRP verification')
      .addRoleOption((option) => option
        .setName('verified_role')
        .setDescription('Role given after verification')
        .setRequired(false))
      .addChannelOption((option) => option
        .setName('log_channel')
        .setDescription('Channel for verification logs')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false))
      .addChannelOption((option) => option
        .setName('verify_channel')
        .setDescription('Suggested channel where members should verify')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false))
      .addStringOption((option) => option
        .setName('nickname_mode')
        .setDescription('How the bot should nickname verified members')
        .addChoices(
          { name: 'Roblox username', value: 'roblox' },
          { name: 'Roblox display name', value: 'display' },
          { name: 'Do not change nicknames', value: 'off' },
        )
        .setRequired(false))),
};
