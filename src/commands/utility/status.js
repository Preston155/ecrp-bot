const { PermissionFlagsBits } = require('discord.js');
const statusPanels = require('../../systems/status/StatusPanelManager');

async function execute(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
      !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    const reply = await message.reply('You need **Manage Server** to post the status panel.');
    setTimeout(() => reply.delete().catch(() => null), 5000);
    return;
  }

  const botPermissions = message.channel.permissionsFor(message.guild.members.me);
  if (!botPermissions?.has(PermissionFlagsBits.SendMessages) ||
      !botPermissions?.has(PermissionFlagsBits.ViewChannel)) {
    return;
  }

  await message.delete().catch(() => null);
  await statusPanels.create(message.channel, message.author.id);
}

module.exports = { execute };
