const manager = require('../../systems/giveaways/GiveawayManager');

module.exports = async function proof(interaction) {
  const id = interaction.options.getString('giveaway', true);
  const image = interaction.options.getAttachment('image', true);
  const note = interaction.options.getString('note');

  if (!image.contentType?.startsWith('image/')) {
    throw new Error('The proof attachment must be an image.');
  }

  const message = await manager.submitProof(id, interaction, image.url, note);
  return `Giveaway proof posted: ${message.url}`;
};
