const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { isGiveawayManager } = require('../../utils/permissions');
const manager = require('../../systems/giveaways/GiveawayManager');

const handlers = {
  start: require('./giveaway-start'),
  end: require('./giveaway-end'),
  reroll: require('./giveaway-reroll'),
  list: require('./giveaway-list'),
  edit: require('./giveaway-edit'),
  delete: require('./giveaway-delete'),
  pause: require('./giveaway-pause'),
  resume: require('./giveaway-resume'),
  proof: require('./giveaway-proof'),
};

function addId(subcommand) {
  return subcommand.addStringOption((option) =>
    option.setName('id').setDescription('Giveaway ID').setRequired(true)
  );
}

const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Create and manage premium giveaways')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('start')
      .setDescription('Start a giveaway')
      .addStringOption((option) => option.setName('prize').setDescription('Prize').setMaxLength(200).setRequired(true))
      .addStringOption((option) => option.setName('duration').setDescription('Examples: 10m, 1h, 1d, 7d').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(20).setRequired(true))
      .addChannelOption((option) => option.setName('channel').setDescription('Channel to post in'))
      .addRoleOption((option) => option.setName('required_role').setDescription('Role required to enter'))
      .addRoleOption((option) => option.setName('bonus_role').setDescription('Role that receives bonus entries'))
      .addIntegerOption((option) => option.setName('bonus_entries').setDescription('Extra weighted entries').setMinValue(1).setMaxValue(100))
      .addRoleOption((option) => option.setName('blacklisted_role').setDescription('Role blocked from entering'))
      .addStringOption((option) => option.setName('minimum_account_age').setDescription('Example: 7d'))
      .addStringOption((option) => option.setName('minimum_server_join_age').setDescription('Example: 1d'))
      .addIntegerOption((option) => option.setName('required_messages').setDescription('Tracked messages required').setMinValue(1))
      .addStringOption((option) => option.setName('allowed_roles').setDescription('Comma-separated role IDs or mentions'))
      .addBooleanOption((option) => option.setName('booster_only').setDescription('Require active server boosting'))
      .addUserOption((option) => option.setName('sponsor').setDescription('Giveaway sponsor'))
      .addAttachmentOption((option) => option.setName('image').setDescription('Giveaway image'))
      .addStringOption((option) => option.setName('image_url').setDescription('External image URL'))
      .addStringOption((option) => option.setName('description').setDescription('Short giveaway description').setMaxLength(1000))
  )
  .addSubcommand((subcommand) => addId(subcommand.setName('end').setDescription('End a giveaway early')))
  .addSubcommand((subcommand) =>
    addId(subcommand.setName('reroll').setDescription('Reroll giveaway winners'))
      .addIntegerOption((option) => option.setName('winners').setDescription('Winners to reroll').setMinValue(1).setMaxValue(20))
  )
  .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active giveaways'))
  .addSubcommand((subcommand) =>
    addId(subcommand.setName('edit').setDescription('Edit an active giveaway'))
      .addStringOption((option) => option.setName('prize').setDescription('New prize').setMaxLength(200))
      .addStringOption((option) => option.setName('duration').setDescription('New time remaining'))
      .addIntegerOption((option) => option.setName('winners').setDescription('New winner count').setMinValue(1).setMaxValue(20))
      .addStringOption((option) => option.setName('description').setDescription('New description').setMaxLength(1000))
      .addRoleOption((option) => option.setName('required_role').setDescription('New required role'))
      .addRoleOption((option) => option.setName('bonus_role').setDescription('New bonus role'))
      .addIntegerOption((option) => option.setName('bonus_entries').setDescription('New bonus entry count').setMinValue(0).setMaxValue(100))
      .addRoleOption((option) => option.setName('blacklisted_role').setDescription('New blacklisted role'))
      .addStringOption((option) => option.setName('allowed_roles').setDescription('New comma-separated allowed role IDs'))
      .addStringOption((option) => option.setName('minimum_account_age').setDescription('New minimum account age'))
      .addStringOption((option) => option.setName('minimum_server_join_age').setDescription('New minimum server join age'))
      .addIntegerOption((option) => option.setName('required_messages').setDescription('New required message count').setMinValue(0))
      .addBooleanOption((option) => option.setName('booster_only').setDescription('Require active server boosting'))
      .addAttachmentOption((option) => option.setName('image').setDescription('New giveaway image'))
      .addStringOption((option) => option.setName('image_url').setDescription('New external image URL'))
  )
  .addSubcommand((subcommand) => addId(subcommand.setName('delete').setDescription('Cancel and remove a giveaway')))
  .addSubcommand((subcommand) => addId(subcommand.setName('pause').setDescription('Pause a giveaway countdown')))
  .addSubcommand((subcommand) => addId(subcommand.setName('resume').setDescription('Resume a paused giveaway')))
  .addSubcommand((subcommand) =>
    subcommand
      .setName('proof')
      .setDescription('Post image proof for an active or previous giveaway')
      .addStringOption((option) =>
        option
          .setName('giveaway')
          .setDescription('Select or search for a giveaway')
          .setAutocomplete(true)
          .setRequired(true)
      )
      .addAttachmentOption((option) =>
        option.setName('image').setDescription('Giveaway proof image').setRequired(true)
      )
      .addStringOption((option) =>
        option.setName('note').setDescription('Optional proof note').setMaxLength(500)
      )
  );

async function execute(interaction) {
  if (!isGiveawayManager(interaction.member)) {
    throw new Error('You need Administrator or a configured giveaway manager role.');
  }
  const subcommand = interaction.options.getSubcommand();
  return handlers[subcommand](interaction);
}

async function autocomplete(interaction) {
  if (!interaction.guildId || !isGiveawayManager(interaction.member)) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  const choices = manager.listAll(interaction.guildId, 25);
  const filtered = choices
    .filter((giveaway) =>
      giveaway.id.toLowerCase().includes(focused) ||
      giveaway.prize.toLowerCase().includes(focused) ||
      giveaway.status.toLowerCase().includes(focused)
    )
    .slice(0, 25)
    .map((giveaway) => ({
      name: `[${giveaway.status.toUpperCase()}] ${giveaway.prize}`.slice(0, 100),
      value: giveaway.id,
    }));
  await interaction.respond(filtered);
}

module.exports = { data, execute, autocomplete };
