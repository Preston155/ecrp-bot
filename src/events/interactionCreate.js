const {
  ActionRowBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const giveawayCommand = require('../commands/giveaways/giveaway');
const manager = require('../systems/giveaways/GiveawayManager');
const { isGiveawayManager } = require('../utils/permissions');
const { disabledStat, ephemeralCard } = require('../utils/componentsV2');
const { parseDuration, shortDuration } = require('../utils/time');
const config = require('../systems/giveaways/GiveawayConfig');
const { logger } = require('../utils/logger');
const sessions = require('../systems/sessions/SessionManager');
const tickets = require('../systems/ticket-system');
const suggestCommand = require('../commands/utility/suggest');
const suggestions = require('../systems/suggestion-system');

async function commandInteraction(interaction) {
  if (interaction.commandName === suggestCommand.data.name) {
    try {
      await suggestions.create(interaction);
    } catch (error) {
      logger.error('suggestion_command_failed', error, { userId: interaction.user.id, guildId: interaction.guildId });
      const payload = { content: error.message || 'Your suggestion could not be posted.', allowedMentions: { parse: [] } };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return;
  }
  if (interaction.commandName !== giveawayCommand.data.name) return;

  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === 'list') {
      await giveawayCommand.execute(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await giveawayCommand.execute(interaction);
    await interaction.editReply({
      content: result || 'Done.',
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.error('giveaway_command_failed', error, {
      subcommand,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    const payload = { content: error.message || 'The giveaway action failed.', allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
}

async function requirementInteraction(interaction, id) {
  const status = await manager.requirementStatus(id, interaction.member);
  const checkButtons = status.checks.slice(0, 4).map((check, index) =>
    disabledStat(
      `gw:req:${index}:${id}`,
      `${check.passed ? 'Passed' : 'Failed'}: ${check.label}`,
      check.passed ? '✅' : '❌'
    )
  );
  checkButtons.push(
    disabledStat(`gw:req:weight:${id}`, `Your Entries: ${status.entry?.weight || status.weight}`, '🎟️')
  );

  await interaction.reply(ephemeralCard(
    'Giveaway Requirements',
    [
      `**Prize:** ${status.giveaway.prize}`,
      `**Entry:** ${status.entry ? 'Entered' : 'Not entered'}`,
      `**Eligibility:** ${status.eligible ? 'Eligible' : 'Not eligible'}`,
      status.checks.length ? '' : 'No special requirements are configured.',
    ].filter(Boolean),
    status.eligible ? 0x22c55e : 0xef4444,
    checkButtons
  ));
}

async function showEditModal(interaction, id) {
  const giveaway = manager.requireGiveaway(id);
  const remaining = giveaway.status === 'paused'
    ? giveaway.remaining_ms
    : Math.max(1000, giveaway.end_time - Date.now());
  const modal = new ModalBuilder()
    .setCustomId(`gw:editmodal:${id}`)
    .setTitle('Edit Giveaway')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize')
          .setLabel('Prize')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(200)
          .setValue(giveaway.prize)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setValue(giveaway.description || '')
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Time remaining (10m, 1h, 1d)')
          .setStyle(TextInputStyle.Short)
          .setValue(shortDuration(remaining))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('Winner count')
          .setStyle(TextInputStyle.Short)
          .setValue(String(giveaway.winner_count))
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function buttonInteraction(interaction) {
  if (await suggestions.handleInteraction(interaction)) return;
  if (interaction.customId.startsWith('session:')) {
    await sessions.handleInteraction(interaction);
    return;
  }

  const [prefix, action, id] = interaction.customId.split(':');
  if (prefix !== 'gw' || !id) return;

  try {
    if (action === 'requirements') {
      await requirementInteraction(interaction, id);
      return;
    }
    if (action === 'edit') {
      if (!isGiveawayManager(interaction.member)) throw new Error('This control is staff-only.');
      await showEditModal(interaction, id);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === 'enter') {
      const result = await manager.enter(id, interaction.member);
      await interaction.editReply(`You entered with **${result.weight}** weighted entr${result.weight === 1 ? 'y' : 'ies'}.`);
      return;
    }
    if (action === 'leave') {
      await manager.leave(id, interaction.member);
      await interaction.editReply('Your entry was removed.');
      return;
    }

    if (!isGiveawayManager(interaction.member)) throw new Error('This control is staff-only.');
    if (action === 'pause') await manager.pause(id, interaction.user.id);
    else if (action === 'resume') await manager.resume(id, interaction.user.id);
    else if (action === 'end') await manager.end(id, interaction.user.id);
    else if (action === 'reroll') await manager.reroll(id, interaction.user.id);
    else throw new Error('Unknown giveaway action.');
    await interaction.editReply(`Giveaway action **${action}** completed.`);
  } catch (error) {
    logger.error('giveaway_button_failed', error, {
      customId: interaction.customId,
      userId: interaction.user.id,
    });
    const payload = { content: error.message || 'That action failed.', allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
}

async function modalInteraction(interaction) {
  const [prefix, action, id] = interaction.customId.split(':');
  if (prefix !== 'gw' || action !== 'editmodal' || !id) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!isGiveawayManager(interaction.member)) throw new Error('This control is staff-only.');
    const durationMs = parseDuration(interaction.fields.getTextInputValue('duration'));
    const winnerCount = Number.parseInt(interaction.fields.getTextInputValue('winners'), 10);
    if (!durationMs || durationMs > config.maxDurationMs) throw new Error('The duration is invalid or too long.');
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) {
      throw new Error('Winner count must be between 1 and 20.');
    }

    await manager.edit(id, interaction.user.id, {
      prize: interaction.fields.getTextInputValue('prize').trim(),
      description: interaction.fields.getTextInputValue('description').trim(),
      durationMs,
      winnerCount,
    });
    await interaction.editReply(`Giveaway \`${id}\` updated.`);
  } catch (error) {
    await interaction.editReply(error.message || 'The giveaway could not be updated.');
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (await tickets.handleInteraction(interaction)) return;
    } catch (error) {
      if (error?.code === 10062 || error?.code === 'InteractionNotReplied') return;
      logger.error('ticket_interaction_failed', error, {
        customId: interaction.customId || null,
        userId: interaction.user?.id || null,
      });
      const payload = { content: error.message || 'That ticket action failed. Please try again.', allowedMentions: { parse: [] } };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!interaction.inGuild()) return;
    if (interaction.isAutocomplete() && interaction.commandName === giveawayCommand.data.name) {
      return giveawayCommand.autocomplete(interaction);
    }
    if (interaction.isChatInputCommand()) return commandInteraction(interaction);
    if (interaction.isButton()) return buttonInteraction(interaction);
    if (interaction.isModalSubmit()) return modalInteraction(interaction);
  },
};
