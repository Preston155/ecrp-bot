const manager = require('../../systems/giveaways/GiveawayManager');
const config = require('../../systems/giveaways/GiveawayConfig');
const { parseDuration } = require('../../utils/time');
const { persistGiveawayImage } = require('../../utils/persist-giveaway-image');

function parseRoleIds(value) {
  return [...new Set((value || '').match(/\d{17,20}/g) || [])];
}

module.exports = async function edit(interaction) {
  const id = interaction.options.getString('id', true);
  const duration = interaction.options.getString('duration');
  const durationMs = duration ? parseDuration(duration) : null;
  if (duration && !durationMs) throw new Error('Invalid duration.');
  if (durationMs && durationMs > config.maxDurationMs) throw new Error('Duration exceeds the configured maximum.');
  const accountAge = interaction.options.getString('minimum_account_age');
  const joinAge = interaction.options.getString('minimum_server_join_age');
  const minimumAccountAgeMs = accountAge ? parseDuration(accountAge) : null;
  const minimumJoinAgeMs = joinAge ? parseDuration(joinAge) : null;
  if (accountAge && !minimumAccountAgeMs) throw new Error('Invalid minimum account age.');
  if (joinAge && !minimumJoinAgeMs) throw new Error('Invalid minimum server join age.');
  const image = interaction.options.getAttachment('image');
  const imageInput = image?.url || interaction.options.getString('image_url');
  const imageUrl = imageInput ? await persistGiveawayImage(imageInput, { sourceName: image?.name }) : undefined;

  const updated = await manager.edit(id, interaction.user.id, {
    prize: interaction.options.getString('prize'),
    durationMs,
    winnerCount: interaction.options.getInteger('winners'),
    description: interaction.options.getString('description') ?? undefined,
    imageUrl,
    requiredRoleId: interaction.options.getRole('required_role')?.id,
    bonusRoleId: interaction.options.getRole('bonus_role')?.id,
    bonusEntries: interaction.options.getInteger('bonus_entries'),
    blacklistedRoleId: interaction.options.getRole('blacklisted_role')?.id,
    allowedRoleIds: interaction.options.getString('allowed_roles')
      ? parseRoleIds(interaction.options.getString('allowed_roles'))
      : null,
    minimumAccountAgeMs,
    minimumJoinAgeMs,
    requiredMessages: interaction.options.getInteger('required_messages'),
    boosterOnly: interaction.options.getBoolean('booster_only'),
  });
  return `Giveaway \`${updated.id}\` updated.`;
};
