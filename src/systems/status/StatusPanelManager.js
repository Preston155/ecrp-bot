const {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const database = require('../../database/db');
const { disabledStat, separator, text } = require('../../utils/componentsV2');
const { logger } = require('../../utils/logger');

const UPDATE_INTERVAL = 30_000;

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

class StatusPanelManager {
  constructor() {
    this.client = null;
    this.interval = null;
    this.updating = false;
  }

  payload({ forceOffline = false } = {}) {
    const client = this.client;
    const online = !forceOffline && Boolean(client?.isReady());
    const latency = online ? Math.max(0, Math.round(client.ws.ping)) : null;
    const status = online ? 'Operational' : 'Offline';
    const accent = online ? 0x22c55e : 0xef4444;

    const container = new ContainerBuilder()
      .setAccentColor(accent)
      .addTextDisplayComponents(text(
        `# ${online ? '🟢' : '🔴'} ECRP Assistant Status\n` +
        `Live service health for ECRP Assistant.\n\n` +
        `**System:** ${status}\n` +
        `**Discord:** ${online ? 'Connected' : 'Disconnected'}\n` +
        `**Last updated:** <t:${Math.floor(Date.now() / 1000)}:R>`
      ))
      .addSeparatorComponents(separator())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          disabledStat('status:latency', online ? `Ping: ${latency}ms` : 'Ping: Offline', '📡'),
          disabledStat('status:uptime', online ? `Uptime: ${formatUptime(process.uptime())}` : 'Uptime: Offline', '⏱️')
        )
      )
      .addTextDisplayComponents(text(
        `-# Auto-refreshes every 30 seconds • ECRP Assistant`
      ));

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  async initialize(client) {
    this.client = client;
    if (this.interval) clearInterval(this.interval);
    await this.updateAll();
    this.interval = setInterval(() => {
      this.updateAll().catch((error) => logger.error('status_panel_update_failed', error));
    }, UPDATE_INTERVAL);
    this.interval.unref();
    logger.info('status_panels_ready', { panels: database.statusPanels().length });
  }

  async create(channel, userId) {
    const message = await channel.send(this.payload());
    database.addStatusPanel(message.id, channel.guild.id, channel.id, userId);
    logger.info('status_panel_created', {
      guildId: channel.guild.id,
      channelId: channel.id,
      messageId: message.id,
      userId,
    });
    return message;
  }

  async markOffline() {
    if (!this.client) return;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    while (this.updating) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await this.updateAll({ forceOffline: true });
    logger.info('status_panels_marked_offline', { panels: database.statusPanels().length });
  }

  async updateAll(payloadOptions = {}) {
    if (this.updating || !this.client) return;
    this.updating = true;

    try {
      for (const panel of database.statusPanels()) {
        try {
          const channel = await this.client.channels.fetch(panel.channel_id);
          if (!channel?.isTextBased()) {
            database.removeStatusPanel(panel.message_id);
            continue;
          }
          const message = await channel.messages.fetch(panel.message_id);
          const payload = this.payload(payloadOptions);
          delete payload.flags;
          await message.edit(payload);
        } catch (error) {
          if (error.code === 10008 || error.code === 10003 || error.code === 50001) {
            database.removeStatusPanel(panel.message_id);
            logger.info('status_panel_removed', {
              messageId: panel.message_id,
              reason: error.code,
            });
          } else {
            logger.warn('status_panel_item_failed', {
              messageId: panel.message_id,
              message: error.message,
            });
          }
        }
      }
    } finally {
      this.updating = false;
    }
  }
}

module.exports = new StatusPanelManager();
