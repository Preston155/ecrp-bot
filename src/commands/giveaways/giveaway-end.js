const manager = require('../../systems/giveaways/GiveawayManager');

module.exports = async function end(interaction) {
  const id = interaction.options.getString('id', true);
  await manager.end(id, interaction.user.id);
  return `Giveaway \`${id}\` ended.`;
};
