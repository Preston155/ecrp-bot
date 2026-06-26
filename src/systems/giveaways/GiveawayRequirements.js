const database = require('../../database/db');
const { shortDuration } = require('../../utils/time');

function roleName(guild, roleId) {
  return roleId ? guild.roles.cache.get(roleId)?.name || `Role ${roleId}` : null;
}

async function evaluate(giveaway, member) {
  const now = Date.now();
  const checks = [];
  const roles = member.roles.cache;

  if (giveaway.required_role_id) {
    checks.push({
      label: `Required role: ${roleName(member.guild, giveaway.required_role_id)}`,
      passed: roles.has(giveaway.required_role_id),
    });
  }

  if (giveaway.allowed_role_ids?.length) {
    checks.push({
      label: 'Allowed role',
      passed: giveaway.allowed_role_ids.some((roleId) => roles.has(roleId)),
    });
  }

  if (giveaway.blacklisted_role_id) {
    checks.push({
      label: `Not blacklisted: ${roleName(member.guild, giveaway.blacklisted_role_id)}`,
      passed: !roles.has(giveaway.blacklisted_role_id),
    });
  }

  if (giveaway.minimum_account_age_ms) {
    checks.push({
      label: `Account age: ${shortDuration(giveaway.minimum_account_age_ms)} minimum`,
      passed: now - member.user.createdTimestamp >= giveaway.minimum_account_age_ms,
    });
  }

  if (giveaway.minimum_join_age_ms) {
    checks.push({
      label: `Server time: ${shortDuration(giveaway.minimum_join_age_ms)} minimum`,
      passed: Boolean(member.joinedTimestamp) &&
        now - member.joinedTimestamp >= giveaway.minimum_join_age_ms,
    });
  }

  if (giveaway.required_messages > 0) {
    const count = database.messageCount(giveaway.guild_id, member.id);
    checks.push({
      label: `Messages: ${count}/${giveaway.required_messages}`,
      passed: count >= giveaway.required_messages,
    });
  }

  if (giveaway.booster_only) {
    checks.push({
      label: 'Server booster',
      passed: Boolean(member.premiumSinceTimestamp),
    });
  }

  const eligible = checks.every((check) => check.passed);
  const bonus = giveaway.bonus_role_id && roles.has(giveaway.bonus_role_id)
    ? Math.max(0, giveaway.bonus_entries || 0)
    : 0;

  return {
    eligible,
    checks,
    weight: 1 + bonus,
    bonus,
  };
}

function summary(giveaway, guild) {
  const lines = [];
  if (giveaway.required_role_id) lines.push(`Required role: <@&${giveaway.required_role_id}>`);
  if (giveaway.allowed_role_ids?.length) {
    lines.push(`Allowed roles: ${giveaway.allowed_role_ids.map((id) => `<@&${id}>`).join(', ')}`);
  }
  if (giveaway.blacklisted_role_id) lines.push(`Blacklisted role: <@&${giveaway.blacklisted_role_id}>`);
  if (giveaway.minimum_account_age_ms) {
    lines.push(`Account age: ${shortDuration(giveaway.minimum_account_age_ms)} minimum`);
  }
  if (giveaway.minimum_join_age_ms) {
    lines.push(`Server membership: ${shortDuration(giveaway.minimum_join_age_ms)} minimum`);
  }
  if (giveaway.required_messages > 0) lines.push(`Messages tracked: ${giveaway.required_messages} minimum`);
  if (giveaway.booster_only) lines.push('Server boosters only');
  if (giveaway.bonus_role_id) {
    lines.push(`Bonus: <@&${giveaway.bonus_role_id}> receives +${giveaway.bonus_entries} entries`);
  }
  return lines.length ? lines : ['No special requirements.'];
}

module.exports = { evaluate, summary };
