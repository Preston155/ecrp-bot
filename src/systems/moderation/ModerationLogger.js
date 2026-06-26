const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const store = require('./ModDatabase');
const { disabledStat, separator, text } = require('../../utils/componentsV2');
const { humanize } = require('./DurationParser');
const { logger } = require('../../utils/logger');

function casePayload(record, title = 'Moderation Case') {
  const target = record.user_id ? `<@${record.user_id}> (\`${record.user_id}\`)` : 'Channel action';
  const duration = record.duration_ms ? humanize(record.duration_ms) : 'Permanent / N/A';
  const expires = record.expires_at ? `<t:${Math.floor(record.expires_at / 1000)}:F>` : 'N/A';
  const evidence = record.evidence_url ? `[View evidence](${record.evidence_url})` : 'None';
  const status = record.removed ? 'Removed' : record.active ? 'Active' : 'Completed';
  const container = new ContainerBuilder()
    .setAccentColor(record.removed ? 0x6b7280 : 0xef4444)
    .addTextDisplayComponents(text(
      `## 🛡️ ${title}\n` +
      `**Case:** \`${record.case_id}\`\n` +
      `**Action:** ${record.action_type.replaceAll('_', ' ')}\n` +
      `**Target:** ${target}\n` +
      `**Moderator:** <@${record.moderator_id}> (\`${record.moderator_id}\`)\n\n` +
      `**Reason**\n${record.reason}\n\n` +
      `**Evidence:** ${evidence}\n` +
      `**Duration:** ${duration}\n` +
      `**Expires:** ${expires}`
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        disabledStat(`mod:case:${record.case_id}`, `Case: ${record.case_id}`, '📁'),
        disabledStat(`mod:status:${record.case_id}`, `Status: ${status}`, '📌')
      )
    )
    .addTextDisplayComponents(text(`-# Created <t:${Math.floor(record.created_at / 1000)}:F>`));
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

async function send(client, guild, record) {
  const config = store.config(guild.id);
  if (!config.mod_log_channel_id) return null;
  try {
    const channel = await client.channels.fetch(config.mod_log_channel_id);
    if (!channel?.isTextBased()) return null;
    const message = await channel.send(casePayload(record, 'Moderation Case Created'));
    store.setLog(record.case_id, message.id, channel.id);
    return message;
  } catch (error) {
    logger.error('moderation_log_failed', error, { caseId: record.case_id, guildId: guild.id });
    return null;
  }
}

async function update(client, record) {
  if (!record.message_id || !record.log_channel_id) return;
  try {
    const channel = await client.channels.fetch(record.log_channel_id);
    const message = await channel.messages.fetch(record.message_id);
    const payload = casePayload(record, 'Moderation Case Updated');
    delete payload.flags;
    await message.edit(payload);
  } catch (error) {
    logger.warn('moderation_log_update_failed', { caseId: record.case_id, message: error.message });
  }
}

module.exports = { send, update, casePayload };
