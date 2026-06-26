function extractId(input) {
  if (input?.id) return input.id;
  const match = String(input || '').match(/\d{17,20}/);
  return match?.[0] || null;
}

async function resolve(client, guild, input) {
  const userId = extractId(input);
  if (!userId) throw new Error('Provide a valid user mention or Discord user ID.');

  let member = guild.members.cache.get(userId) || null;
  if (!member) member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user || await client.users.fetch(userId).catch(() => null);

  return {
    userId,
    user,
    member,
    tag: user?.tag || user?.username || `Unknown User (${userId})`,
    inGuild: Boolean(member),
  };
}

module.exports = { extractId, resolve };
