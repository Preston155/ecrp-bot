const {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const config = require('./GiveawayConfig');
const database = require('../../database/db');
const { disabledStat, text } = require('../../utils/componentsV2');
const { logger } = require('../../utils/logger');

async function logAction(client, giveaway, action, actorId, details = {}) {
  database.log(giveaway.id, giveaway.guild_id, actorId, action, details);
  logger.info('giveaway_action', {
    giveawayId: giveaway.id,
    guildId: giveaway.guild_id,
    actorId,
    action,
    ...details,
  });

  if (!config.logChannelId) return;

  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (!channel?.isTextBased()) return;

    const container = new ContainerBuilder()
      .setAccentColor(0x5865f2)
      .addTextDisplayComponents(text(
        `## Giveaway Log\n**${action}**\n${details.note || 'Giveaway activity recorded.'}`
      ))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          disabledStat(`gw:log:action:${Date.now()}`, `Action: ${action}`, '📌'),
          disabledStat(`gw:log:prize:${Date.now()}`, `Prize: ${giveaway.prize}`, '🎁'),
          disabledStat(`gw:log:actor:${Date.now()}`, `Actor: ${actorId || 'System'}`, '👤')
        )
      )
      .addTextDisplayComponents(text(`-# ${giveaway.id} • Guild ${giveaway.guild_id}`));

    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.error('giveaway_log_delivery_failed', error, { giveawayId: giveaway.id });
  }
}

module.exports = { logAction };
