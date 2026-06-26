const manager = require('../../systems/giveaways/GiveawayManager');

module.exports = async function remove(interaction) {
  const id = interaction.options.getString('id', true);
  await manager.delete(id, interaction.user.id);
  return `Giveaway \`${id}\` cancelled and its message was removed.`;
};
