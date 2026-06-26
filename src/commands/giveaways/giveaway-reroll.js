const manager = require('../../systems/giveaways/GiveawayManager');

module.exports = async function reroll(interaction) {
  const id = interaction.options.getString('id', true);
  const count = interaction.options.getInteger('winners');
  const winners = await manager.reroll(id, interaction.user.id, count);
  return `Rerolled \`${id}\` and selected ${winners.length} winner${winners.length === 1 ? '' : 's'}.`;
};
