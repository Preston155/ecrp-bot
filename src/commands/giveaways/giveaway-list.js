const { ContainerBuilder, MessageFlags } = require('discord.js');
const manager = require('../../systems/giveaways/GiveawayManager');
const { text } = require('../../utils/componentsV2');
const { discordTimestamp } = require('../../utils/time');

module.exports = async function list(interaction) {
  const giveaways = manager.list(interaction.guild.id);
  const lines = giveaways.length
    ? giveaways.map((giveaway) =>
      `**${giveaway.prize}** • \`${giveaway.id}\`\n` +
      `${giveaway.status === 'paused' ? 'Paused' : `Ends ${discordTimestamp(giveaway.end_time)}`} • <#${giveaway.channel_id}>`
    )
    : ['No active giveaways in this server.'];

  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(text(`## Active Giveaways\n${lines.join('\n\n')}`));

  await interaction.reply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  });
  return null;
};
