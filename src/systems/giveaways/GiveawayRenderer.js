const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { disabledStat, separator, text } = require('../../utils/componentsV2');
const { discordTimestamp, shortDuration } = require('../../utils/time');
const requirements = require('./GiveawayRequirements');

const COLORS = {
  active: 0x22c55e,
  paused: 0xf59e0b,
  ended: 0x5865f2,
  cancelled: 0x6b7280,
};

function statusLabel(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function mentionAllowlist(giveaway, winnerRows = []) {
  return {
    users: [...new Set([
      giveaway.host_id,
      giveaway.sponsor_id,
      ...winnerRows.map((winner) => winner.user_id),
    ].filter(Boolean))],
    roles: [...new Set([
      giveaway.required_role_id,
      giveaway.bonus_role_id,
      giveaway.blacklisted_role_id,
      ...(giveaway.allowed_role_ids || []),
    ].filter(Boolean))],
    parse: [],
    repliedUser: false,
  };
}

function actionRows(giveaway) {
  const closed = ['ended', 'cancelled'].includes(giveaway.status);
  const paused = giveaway.status === 'paused';
  return [
    new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw:enter:${giveaway.id}`)
      .setLabel('Enter Giveaway')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed || paused),
    new ButtonBuilder()
      .setCustomId(`gw:leave:${giveaway.id}`)
      .setLabel('Leave')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`gw:requirements:${giveaway.id}`)
      .setLabel('Requirements')
      .setEmoji('ℹ️')
      .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function giveawayPayload(giveaway, stats, winnerRows = []) {
  const now = Date.now();
  const remaining = giveaway.status === 'paused'
    ? giveaway.remaining_ms || 0
    : Math.max(0, giveaway.end_time - now);
  const reqLines = requirements.summary(giveaway);
  const winnerText = winnerRows.length
    ? `\n**Winners:** ${winnerRows.map((winner) => `<@${winner.user_id}>`).join(' ')}`
    : giveaway.status === 'ended'
      ? '\n**Winners:** No valid entries.'
      : '';
  const endsText = giveaway.status === 'paused'
    ? `Paused with ${shortDuration(remaining)} remaining`
    : discordTimestamp(giveaway.end_time);

  const container = new ContainerBuilder()
    .setAccentColor(COLORS[giveaway.status] || COLORS.active)
    .addTextDisplayComponents(text(
      `# 🎉 ${giveaway.prize}\n` +
      `${giveaway.description || 'Enter below for your chance to win.'}\n\n` +
      `**Hosted by:** <@${giveaway.host_id}>${giveaway.sponsor_id ? `\n**Sponsored by:** <@${giveaway.sponsor_id}>` : ''}\n` +
      `**Ends:** ${endsText}\n` +
      `**Status:** ${statusLabel(giveaway.status)}\n\n` +
      `**Requirements**\n${reqLines.map((line) => `• ${line}`).join('\n')}${winnerText}`
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        disabledStat(`gw:stat:entries:${giveaway.id}`, `Entries: ${stats.users}`, '🎟️'),
        disabledStat(`gw:stat:time:${giveaway.id}`, `Ends: ${shortDuration(remaining)}`, '⏰'),
        disabledStat(`gw:stat:winners:${giveaway.id}`, `Winners: ${giveaway.winner_count}`, '🏆')
      )
    );

  if (giveaway.image_url) {
    container
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(giveaway.image_url)
        )
      );
  }

  container.addSeparatorComponents(separator());
  for (const row of actionRows(giveaway)) container.addActionRowComponents(row);
  container.addTextDisplayComponents(text(`-# Giveaway ID: ${giveaway.id}`));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: mentionAllowlist(giveaway, winnerRows),
  };
}

function announcementPayload(giveaway, winners, stats, reroll = false) {
  const mentions = winners.map((winner) => `<@${winner.user_id}>`).join(' ') || 'No valid entries.';
  const allowedUsers = [...new Set([
    giveaway.host_id,
    giveaway.sponsor_id,
    ...winners.map((winner) => winner.user_id),
  ].filter(Boolean))];

  const container = new ContainerBuilder()
    .setAccentColor(reroll ? 0xf59e0b : 0x5865f2)
    .addTextDisplayComponents(text(
      `## ${reroll ? '🔄 Giveaway Rerolled' : '🏆 Giveaway Ended'}\n` +
      `**${giveaway.prize}**\n\n` +
      `**Winner${winners.length === 1 ? '' : 's'}:** ${mentions}\n` +
      `**Entries:** ${stats.users}\n` +
      `**Hosted by:** <@${giveaway.host_id}>\n` +
      `-# Giveaway ID: ${giveaway.id}`
    ));

  if (giveaway.message_id) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('View Giveaway')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${giveaway.guild_id}/${giveaway.channel_id}/${giveaway.message_id}`)
      )
    );
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: {
      users: allowedUsers,
      roles: [],
      parse: [],
      repliedUser: false,
    },
  };
}

function proofPayload(giveaway, proof) {
  const status = statusLabel(giveaway.status);
  const container = new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(
      `## 📸 Giveaway Proof\n` +
      `**${giveaway.prize}** • ${status}\n` +
      `**Hosted by:** <@${giveaway.host_id}>\n` +
      `**Submitted by:** <@${proof.submittedBy}>` +
      (proof.note ? `\n\n**Proof Note**\n${proof.note}` : '')
        ))
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(proof.imageUrl)
        )
    )
    .addTextDisplayComponents(text(`-# Giveaway ID: ${giveaway.id}`));

  if (giveaway.message_id) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('View Giveaway')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${giveaway.guild_id}/${giveaway.channel_id}/${giveaway.message_id}`)
      )
    );
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: {
      users: [...new Set([giveaway.host_id, proof.submittedBy].filter(Boolean))],
      roles: [],
      parse: [],
      repliedUser: false,
    },
  };
}

module.exports = { giveawayPayload, announcementPayload, proofPayload };
