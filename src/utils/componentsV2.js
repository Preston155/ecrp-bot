const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function separator() {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function disabledStat(customId, label, emoji) {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 80))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function ephemeralCard(title, lines, color = 0x5865f2, buttons = []) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(text(`## ${title}\n${lines.join('\n')}`));

  if (buttons.length) {
    container.addSeparatorComponents(separator());
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
  }

  return {
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

module.exports = { text, separator, disabledStat, ephemeralCard };
