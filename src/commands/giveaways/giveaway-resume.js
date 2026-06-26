const manager = require('../../systems/giveaways/GiveawayManager');

module.exports = async function resume(interaction) {
  const id = interaction.options.getString('id', true);
  await manager.resume(id, interaction.user.id);
  return `Giveaway \`${id}\` resumed.`;
};
