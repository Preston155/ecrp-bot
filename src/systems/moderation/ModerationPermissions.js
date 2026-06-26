const { PermissionFlagsBits } = require('discord.js');
const store = require('./ModDatabase');

const LEVELS = {
  moderator: [
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.ManageMessages,
  ],
  admin: [PermissionFlagsBits.BanMembers],
  channels: [PermissionFlagsBits.ManageChannels],
  messages: [PermissionFlagsBits.ManageMessages],
};

function hasRole(member, roleIds) {
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function requireStaff(interaction, level = 'moderator') {
  const member = interaction.member;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const config = store.config(interaction.guildId);
  if (hasRole(member, config.admin_role_ids)) return;
  if (level === 'moderator' && hasRole(member, config.moderator_role_ids)) return;
  if ((LEVELS[level] || []).some((permission) => member.permissions.has(permission))) return;
  throw new Error('You do not have permission to use this moderation command.');
}

function requireHierarchy(interaction, target, { allowSelf = false } = {}) {
  if (!target.member) return;
  const actor = interaction.member;
  const bot = interaction.guild.members.me;

  if (!allowSelf && target.userId === interaction.user.id) throw new Error('You cannot moderate yourself.');
  if (target.userId === interaction.client.user.id) throw new Error('You cannot moderate this bot.');
  if (target.userId === interaction.guild.ownerId) throw new Error('The server owner cannot be moderated.');
  if (interaction.user.id !== interaction.guild.ownerId &&
      target.member.roles.highest.position >= actor.roles.highest.position) {
    throw new Error('That member has an equal or higher role than you.');
  }
  if (target.member.roles.highest.position >= bot.roles.highest.position) {
    throw new Error('My highest role must be above the target member.');
  }
}

module.exports = { requireStaff, requireHierarchy };
