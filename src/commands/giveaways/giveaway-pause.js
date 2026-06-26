const manager = require('../../systems/giveaways/GiveawayManager');

module.exports = async function pause(interaction) {
  const id = interaction.options.getString('id', true);
  await manager.pause(id, interaction.user.id);
  return `Giveaway \`${id}\` paused.`;
};
