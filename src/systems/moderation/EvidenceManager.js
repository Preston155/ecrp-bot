function resolve(interaction) {
  const attachment = interaction.options.getAttachment('evidence_attachment');
  const url = attachment?.url || interaction.options.getString('evidence');
  if (!url) return null;
  try {
    return new URL(url).toString();
  } catch {
    throw new Error('Evidence must be a valid URL or attachment.');
  }
}

module.exports = { resolve };
