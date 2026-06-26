const { PermissionFlagsBits } = require('discord.js');
const { logger } = require('../../utils/logger');

const MAX_PURGE = 500;
const MAX_SCAN = 10_000;
const BULK_DELETE_AGE = 14 * 24 * 60 * 60 * 1000 - 60_000;

async function deleteOldMessages(messages) {
  let deleted = 0;

  for (let index = 0; index < messages.length; index += 5) {
    const batch = messages.slice(index, index + 5);
    const results = await Promise.allSettled(batch.map((item) => item.delete()));
    deleted += results.filter((result) => result.status === 'fulfilled').length;
  }

  return deleted;
}

async function collectMessages(channel, amount) {
  const selected = [];
  let before;
  let scanned = 0;
  let pinnedSkipped = 0;

  while (selected.length < amount && scanned < MAX_SCAN) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, MAX_SCAN - scanned),
      ...(before ? { before } : {}),
    });

    if (!page.size) break;

    scanned += page.size;
    before = page.last().id;

    for (const item of page.values()) {
      if (item.pinned) {
        pinnedSkipped += 1;
      } else if (selected.length < amount) {
        selected.push(item);
      }
    }

    if (page.size < 100) break;
  }

  return { selected, scanned, pinnedSkipped };
}

async function execute(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages) &&
      !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    const reply = await message.reply('You need **Manage Messages** to use this command.');
    setTimeout(() => reply.delete().catch(() => null), 5000);
    return;
  }

  const amount = Number.parseInt(args[0], 10);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PURGE) {
    const reply = await message.reply(`Use \`-purge <1-${MAX_PURGE}>\`.`);
    setTimeout(() => reply.delete().catch(() => null), 5000);
    return;
  }

  const botPermissions = message.channel.permissionsFor(message.guild.members.me);
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
  ];
  if (!botPermissions || !required.every((permission) => botPermissions.has(permission))) {
    const reply = await message.reply(
      'I need **View Channel**, **Read Message History**, and **Manage Messages** here.'
    );
    setTimeout(() => reply.delete().catch(() => null), 7000);
    return;
  }

  await message.delete().catch(() => null);

  const { selected, scanned, pinnedSkipped } = await collectMessages(message.channel, amount);
  const cutoff = Date.now() - BULK_DELETE_AGE;
  const recent = selected.filter((item) => item.createdTimestamp > cutoff);
  const old = selected.filter((item) => item.createdTimestamp <= cutoff);

  let deleted = 0;
  if (recent.length) {
    const bulkDeleted = await message.channel.bulkDelete(
      recent.map((item) => item.id),
      true
    );
    deleted += bulkDeleted.size;
  }
  const oldDeleted = await deleteOldMessages(old);
  deleted += oldDeleted;

  const summary = await message.channel.send({
    content:
      `Deleted **${deleted}** message${deleted === 1 ? '' : 's'}.` +
      (pinnedSkipped ? ` Skipped pinned messages.` : ''),
    allowedMentions: { parse: [] },
  });
  setTimeout(() => summary.delete().catch(() => null), 5000);

  logger.info('purge_completed', {
    guildId: message.guildId,
    channelId: message.channelId,
    moderatorId: message.author.id,
    requested: amount,
    deleted,
    scanned,
    oldDeleted,
  });
}

module.exports = { execute };
