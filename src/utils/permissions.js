const { PermissionFlagsBits } = require('discord.js');
const config = require('../systems/giveaways/GiveawayConfig');

function isGiveawayManager(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return config.managerRoleIds.some((roleId) => member.roles?.cache?.has(roleId));
}

module.exports = { isGiveawayManager };
