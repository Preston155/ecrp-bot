const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { JsonStore } = require('../utils/json-store');
const { logger } = require('../utils/logger');

const store = new JsonStore('verification.json', {
  guilds: {},
  links: {},
  pending: {},
});

const CODE_TTL_MS = 30 * 60 * 1000;
const VERIFY_COLOR = 0x22c55e;
const INFO_COLOR = 0x2b7fff;
const ERROR_COLOR = 0xef4444;

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function makeCode(userId) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ECRP-${userId.slice(-4)}-${random}`;
}

function cleanUsername(input) {
  return String(input || '').trim().replace(/^@+/, '').slice(0, 32);
}

function configOf(data, guildId) {
  data.guilds[guildId] ??= {
    verifiedRoleId: null,
    logChannelId: null,
    verifyChannelId: null,
    nicknameMode: 'roblox',
  };
  return data.guilds[guildId];
}

function linkOf(data, guildId, userId) {
  return data.links[key(guildId, userId)] || null;
}

function pendingOf(data, guildId, userId) {
  const item = data.pending[key(guildId, userId)] || null;
  if (!item) return null;
  if (item.expiresAt && item.expiresAt < Date.now()) {
    delete data.pending[key(guildId, userId)];
    return null;
  }
  return item;
}

async function robloxFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'ECRP-Assistant-Verification/1.0',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Roblox API returned ${res.status}. Try again in a minute.`);
  return res.json();
}

async function resolveRobloxUser(username) {
  const clean = cleanUsername(username);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(clean)) {
    throw new Error('Enter a real Roblox username, 3-20 characters, letters/numbers/underscore only.');
  }
  const lookup = await robloxFetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    body: JSON.stringify({ usernames: [clean], excludeBannedUsers: false }),
  });
  const found = lookup.data?.[0];
  if (!found?.id) throw new Error(`I could not find a Roblox account named **${clean}**.`);
  const profile = await robloxFetch(`https://users.roblox.com/v1/users/${found.id}`);
  let avatarUrl = null;
  try {
    const thumbs = await robloxFetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${found.id}&size=150x150&format=Png&isCircular=false`);
    avatarUrl = thumbs.data?.[0]?.imageUrl || null;
  } catch {
    avatarUrl = null;
  }
  return {
    id: String(found.id),
    name: profile.name || found.name,
    displayName: profile.displayName || found.displayName || found.name,
    description: profile.description || '',
    created: profile.created || null,
    isBanned: Boolean(profile.isBanned),
    avatarUrl,
  };
}

function verifyEmbed({ title, description, color = INFO_COLOR, robloxUser = null, fields = [] }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  if (robloxUser?.avatarUrl) embed.setThumbnail(robloxUser.avatarUrl);
  if (robloxUser) {
    embed.addFields({
      name: 'Roblox Account',
      value: `**${robloxUser.displayName}** (@${robloxUser.name})\nID: \`${robloxUser.id}\``,
      inline: false,
    });
  }
  if (fields.length) embed.addFields(fields);
  return embed;
}

function checkButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:check')
      .setLabel('I added the code')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('verify:cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function start(interaction, username) {
  const robloxUser = await resolveRobloxUser(username);
  const code = makeCode(interaction.user.id);
  await store.update((data) => {
    configOf(data, interaction.guildId);
    data.pending[key(interaction.guildId, interaction.user.id)] = {
      code,
      robloxId: robloxUser.id,
      username: robloxUser.name,
      displayName: robloxUser.displayName,
      avatarUrl: robloxUser.avatarUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + CODE_TTL_MS,
    };
    return data;
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [verifyEmbed({
      title: '🔐 ECRP Roblox Verification',
      color: INFO_COLOR,
      robloxUser,
      description: [
        'Put this code in your Roblox **About / Description**:',
        `### \`${code}\``,
        'Then press **I added the code** below. This expires in **30 minutes**.',
      ].join('\n'),
      fields: [
        { name: 'Why?', value: 'This proves you own the Roblox account before ECRP links it to your Discord.', inline: false },
      ],
    })],
    components: [checkButton()],
    allowedMentions: { parse: [] },
  });
}

async function applyMemberRewards(member, config, robloxUser) {
  const changes = [];
  if (config.verifiedRoleId) {
    const role = member.guild.roles.cache.get(config.verifiedRoleId);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'ECRP Roblox verification').catch((error) => {
        logger.warn('verify_role_add_failed', { guildId: member.guild.id, userId: member.id, roleId: role.id, message: error.message });
      });
      changes.push(`Role: ${role.name}`);
    }
  }

  if (config.nicknameMode && config.nicknameMode !== 'off') {
    const nickBase = config.nicknameMode === 'display' ? robloxUser.displayName : robloxUser.name;
    const nickname = nickBase.slice(0, 32);
    if (member.manageable && nickname && member.displayName !== nickname) {
      await member.setNickname(nickname, 'ECRP Roblox verification').catch((error) => {
        logger.warn('verify_nickname_failed', { guildId: member.guild.id, userId: member.id, message: error.message });
      });
      changes.push(`Nickname: ${nickname}`);
    }
  }
  return changes;
}

async function sendLog(guild, config, embed) {
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
}

async function complete(interaction) {
  let pending;
  let config;
  await store.update((data) => {
    config = configOf(data, interaction.guildId);
    pending = pendingOf(data, interaction.guildId, interaction.user.id);
    return data;
  });
  if (!pending) throw new Error('No active verification found. Run `/verify start` again.');

  const robloxUser = await resolveRobloxUser(pending.username);
  if (robloxUser.id !== pending.robloxId) throw new Error('That Roblox username changed accounts. Start verification again.');
  if (!String(robloxUser.description || '').includes(pending.code)) {
    throw new Error(`I do not see your code in the Roblox profile description yet. Add \`${pending.code}\` and try again.`);
  }

  const changes = await applyMemberRewards(interaction.member, config, robloxUser);
  await store.update((data) => {
    configOf(data, interaction.guildId);
    data.links[key(interaction.guildId, interaction.user.id)] = {
      discordId: interaction.user.id,
      robloxId: robloxUser.id,
      username: robloxUser.name,
      displayName: robloxUser.displayName,
      avatarUrl: robloxUser.avatarUrl,
      verifiedAt: Date.now(),
    };
    delete data.pending[key(interaction.guildId, interaction.user.id)];
    return data;
  });

  const embed = verifyEmbed({
    title: '✅ Verified',
    color: VERIFY_COLOR,
    robloxUser,
    description: `${interaction.user} is now verified with ECRP.`,
    fields: [{ name: 'Applied', value: changes.length ? changes.join('\n') : 'Linked account saved.', inline: false }],
  });
  await sendLog(interaction.guild, config, embed);
  return { embed, robloxUser, changes };
}

async function check(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await complete(interaction);
  await interaction.editReply({ embeds: [result.embed], components: [], allowedMentions: { parse: [] } });
}

async function cancel(interaction) {
  await store.update((data) => {
    delete data.pending[key(interaction.guildId, interaction.user.id)];
    return data;
  });
  await interaction.reply({ content: 'Verification cancelled.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function profile(interaction, targetUser = null) {
  const user = targetUser || interaction.user;
  const data = await store.read();
  const link = linkOf(data, interaction.guildId, user.id);
  if (!link) {
    await interaction.reply({ content: `${user.id === interaction.user.id ? 'You are' : `${user} is`} not verified yet.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const embed = verifyEmbed({
    title: '🪪 ECRP Verification Profile',
    color: INFO_COLOR,
    robloxUser: link,
    description: `Discord: ${user}\nVerified: <t:${Math.floor(link.verifiedAt / 1000)}:R>`,
  });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function unlink(interaction) {
  await store.update((data) => {
    delete data.links[key(interaction.guildId, interaction.user.id)];
    delete data.pending[key(interaction.guildId, interaction.user.id)];
    return data;
  });
  await interaction.reply({ content: 'Your Roblox verification link was removed.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

function requireManageGuild(member) {
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new Error('You need Manage Server to configure verification.');
  }
}

async function settingsEmbed(guildId, guild) {
  const data = await store.read();
  const config = configOf(data, guildId);
  const linked = Object.keys(data.links).filter((k) => k.startsWith(`${guildId}:`)).length;
  return verifyEmbed({
    title: '🛡️ ECRP Verification Settings',
    color: INFO_COLOR,
    description: 'Roblox verification is active. Users verify by placing a code in their Roblox About/Description.',
    fields: [
      { name: 'Verified Role', value: config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'Not set', inline: true },
      { name: 'Log Channel', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Not set', inline: true },
      { name: 'Verify Channel', value: config.verifyChannelId ? `<#${config.verifyChannelId}>` : 'Any channel', inline: true },
      { name: 'Nickname Mode', value: config.nicknameMode || 'roblox', inline: true },
      { name: 'Verified Users', value: String(linked), inline: true },
      { name: 'Commands', value: '`/verify start`, `/verify check`, `/verify profile`, `/verify unlink`\nStaff: `-verifyrole @role`, `-verifylogs #channel`, `-verifychannel #channel`, `-verifynick roblox|display|off`', inline: false },
    ],
  });
}

async function setup(interaction) {
  requireManageGuild(interaction.member);
  const role = interaction.options.getRole('verified_role');
  const logs = interaction.options.getChannel('log_channel');
  const verifyChannel = interaction.options.getChannel('verify_channel');
  const nicknameMode = interaction.options.getString('nickname_mode');
  await store.update((data) => {
    const config = configOf(data, interaction.guildId);
    if (role) config.verifiedRoleId = role.id;
    if (logs) config.logChannelId = logs.id;
    if (verifyChannel) config.verifyChannelId = verifyChannel.id;
    if (nicknameMode) config.nicknameMode = nicknameMode;
    return data;
  });
  await interaction.reply({ embeds: [await settingsEmbed(interaction.guildId, interaction.guild)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function handleCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return start(interaction, interaction.options.getString('username', true));
  if (sub === 'check') return check(interaction);
  if (sub === 'profile') return profile(interaction, interaction.options.getUser('user'));
  if (sub === 'unlink') return unlink(interaction);
  if (sub === 'setup') return setup(interaction);
}

async function handleInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('verify:')) return false;
  try {
    if (interaction.customId === 'verify:check') await check(interaction);
    else if (interaction.customId === 'verify:cancel') await cancel(interaction);
    else return false;
  } catch (error) {
    const payload = { content: error.message || 'Verification failed.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
  return true;
}

async function prefixCommand(message, args) {
  const command = message.content.trim().split(/\s+/)[0].toLowerCase();
  requireManageGuild(message.member);
  if (command === '-verifyrole') {
    const role = message.mentions.roles.first();
    if (!role) throw new Error('Usage: `-verifyrole @role`');
    await store.update((data) => { configOf(data, message.guildId).verifiedRoleId = role.id; return data; });
    await message.channel.send({ content: `✅ Verification role set to ${role}.`, allowedMentions: { parse: [] } });
  } else if (command === '-verifylogs') {
    const channel = message.mentions.channels.first();
    if (!channel?.isTextBased()) throw new Error('Usage: `-verifylogs #channel`');
    await store.update((data) => { configOf(data, message.guildId).logChannelId = channel.id; return data; });
    await message.channel.send({ content: `✅ Verification logs set to ${channel}.`, allowedMentions: { parse: [] } });
  } else if (command === '-verifychannel') {
    const channel = message.mentions.channels.first();
    if (!channel?.isTextBased()) throw new Error('Usage: `-verifychannel #channel`');
    await store.update((data) => { configOf(data, message.guildId).verifyChannelId = channel.id; return data; });
    await message.channel.send({ content: `✅ Verification channel set to ${channel}.`, allowedMentions: { parse: [] } });
  } else if (command === '-verifynick') {
    const mode = (args[0] || '').toLowerCase();
    if (!['roblox', 'display', 'off'].includes(mode)) throw new Error('Usage: `-verifynick roblox|display|off`');
    await store.update((data) => { configOf(data, message.guildId).nicknameMode = mode; return data; });
    await message.channel.send({ content: `✅ Verification nickname mode set to **${mode}**.`, allowedMentions: { parse: [] } });
  } else if (command === '-verifysettings') {
    await message.channel.send({ embeds: [await settingsEmbed(message.guildId, message.guild)], allowedMentions: { parse: [] } });
  }
  await message.delete().catch(() => null);
}

async function flushStore() {
  await store.write(await store.read());
}

module.exports = {
  handleCommand,
  handleInteraction,
  prefixCommand,
  resolveRobloxUser,
  flushStore,
};
