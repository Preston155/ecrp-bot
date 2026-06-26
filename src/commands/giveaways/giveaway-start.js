const { ChannelType } = require('discord.js');
const manager = require('../../systems/giveaways/GiveawayManager');
const config = require('../../systems/giveaways/GiveawayConfig');
const { parseDuration } = require('../../utils/time');
const { persistGiveawayImage } = require('../../utils/persist-giveaway-image');

function parseRoleIds(value) {
  return [...new Set((value || '').match(/\d{17,20}/g) || [])];
}

module.exports = async function start(interaction) {
  const durationMs = parseDuration(interaction.options.getString('duration', true));
  if (!durationMs) throw new Error('Invalid duration. Try `10m`, `1h`, `1d`, or `7d`.');
  if (durationMs > config.maxDurationMs) {
    throw new Error(`Giveaways cannot run longer than ${Math.floor(config.maxDurationMs / 86_400_000)} days.`);
  }

  const minimumAccountAge = interaction.options.getString('minimum_account_age');
  const minimumJoinAge = interaction.options.getString('minimum_server_join_age');
  const minimumAccountAgeMs = minimumAccountAge ? parseDuration(minimumAccountAge) : null;
  const minimumJoinAgeMs = minimumJoinAge ? parseDuration(minimumJoinAge) : null;
  if (minimumAccountAge && !minimumAccountAgeMs) throw new Error('Invalid minimum account age.');
  if (minimumJoinAge && !minimumJoinAgeMs) throw new Error('Invalid minimum server join age.');

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new Error('Giveaways must be posted in a text or announcement channel.');
  }

  const image = interaction.options.getAttachment('image');
  const imageInput = image?.url || interaction.options.getString('image_url');
  const imageUrl = imageInput ? await persistGiveawayImage(imageInput, { sourceName: image?.name }) : null;

  const giveaway = await manager.create({
    guild: interaction.guild,
    channel,
    prize: interaction.options.getString('prize', true),
    durationMs,
    winnerCount: interaction.options.getInteger('winners', true),
    requiredRoleId: interaction.options.getRole('required_role')?.id,
    bonusRoleId: interaction.options.getRole('bonus_role')?.id,
    bonusEntries: interaction.options.getInteger('bonus_entries') || 0,
    blacklistedRoleId: interaction.options.getRole('blacklisted_role')?.id,
    minimumAccountAgeMs,
    minimumJoinAgeMs,
    requiredMessages: interaction.options.getInteger('required_messages') || 0,
    allowedRoleIds: parseRoleIds(interaction.options.getString('allowed_roles')),
    boosterOnly: interaction.options.getBoolean('booster_only') || false,
    sponsor: interaction.options.getUser('sponsor'),
    imageUrl,
    description: interaction.options.getString('description'),
    host: interaction.user,
    createdBy: interaction.user,
  });

  return `Giveaway \`${giveaway.id}\` posted in <#${channel.id}>.`;
};
