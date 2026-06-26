const store = require('./ModDatabase');
const cases = require('./CaseManager');
const modLogger = require('./ModerationLogger');
const { logger } = require('../../utils/logger');

class PunishmentManager {
  constructor() {
    this.client = null;
    this.timers = new Map();
  }

  async initialize(client) {
    this.client = client;
    for (const punishment of store.activePunishments()) this.schedule(punishment);
    logger.info('moderation_recovery_ready', { punishments: store.activePunishments().length });
  }

  create(record, type) {
    const punishment = {
      punishment_id: store.randomId('PUN'),
      case_id: record.case_id,
      guild_id: record.guild_id,
      user_id: record.user_id,
      type,
      duration_ms: record.duration_ms,
      expires_at: record.expires_at,
      created_at: Date.now(),
    };
    store.insertPunishment(punishment);
    if (punishment.expires_at) this.schedule(punishment);
    return punishment;
  }

  clear(userId, guildId, types, actorId, reason) {
    for (const [id, timer] of this.timers) {
      if (timer.userId === userId && timer.guildId === guildId && types.includes(timer.type)) {
        clearTimeout(timer.handle);
        this.timers.delete(id);
      }
    }
    store.endPunishments(guildId, userId, types, actorId, reason);
  }

  schedule(punishment) {
    const previous = this.timers.get(punishment.punishment_id);
    if (previous) clearTimeout(previous.handle);
    const delay = Math.max(0, punishment.expires_at - Date.now());
    const maxDelay = 2_147_000_000;
    const handle = setTimeout(() => {
      if (delay > maxDelay) {
        this.schedule(punishment);
        return;
      }
      this.expire(punishment).catch((error) => {
        logger.error('punishment_expiration_failed', error, { punishmentId: punishment.punishment_id });
      });
    }, Math.min(delay, maxDelay));
    handle.unref();
    this.timers.set(punishment.punishment_id, { handle, ...punishment });
  }

  async expire(punishment) {
    this.timers.delete(punishment.punishment_id);
    const guild = await this.client.guilds.fetch(punishment.guild_id).catch(() => null);
    if (!guild) return;

    if (punishment.type === 'TEMPBAN') {
      await guild.bans.remove(punishment.user_id, 'Temporary ban expired').catch((error) => {
        if (error.code !== 10026) throw error;
      });
    } else if (punishment.type === 'TIMEOUT') {
      const member = await guild.members.fetch(punishment.user_id).catch(() => null);
      if (member?.isCommunicationDisabled()) {
        await member.timeout(null, 'Timeout expired').catch(() => null);
      }
    }

    store.endPunishment(punishment.punishment_id, 'system', 'Expired automatically');
    const target = {
      userId: punishment.user_id,
      tag: `User ${punishment.user_id}`,
    };
    const record = cases.create({
      guild,
      target,
      moderator: { id: this.client.user.id, tag: this.client.user.tag },
      action: punishment.type === 'TEMPBAN' ? 'UNBAN' : 'UNTIMEOUT',
      reason: 'Temporary punishment expired automatically.',
      active: false,
      metadata: { expiredPunishmentId: punishment.punishment_id },
    });
    await modLogger.send(this.client, guild, record);
  }
}

module.exports = new PunishmentManager();
