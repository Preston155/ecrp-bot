const database = require('../../database/db');
const config = require('./GiveawayConfig');
const requirements = require('./GiveawayRequirements');
const renderer = require('./GiveawayRenderer');
const { pickWeighted } = require('./GiveawayPicker');
const { logAction } = require('./GiveawayLogger');
const { giveawayId } = require('../../utils/ids');
const { logger } = require('../../utils/logger');

class GiveawayManager {
  constructor() {
    this.client = null;
    this.interval = null;
    this.refreshTimers = new Map();
    this.endTimers = new Map();
    this.runningEnds = new Set();
  }

  async initialize(client) {
    this.client = client;
    if (this.interval) clearInterval(this.interval);

    await this.tick();
    for (const giveaway of database.activeGiveaways()) {
      if (giveaway.status === 'active') this.scheduleEnd(giveaway);
    }
    this.interval = setInterval(() => {
      this.tick().catch((error) => logger.error('giveaway_scheduler_failed', error));
    }, config.updateIntervalMs);
    this.interval.unref();

    logger.info('giveaway_system_ready', {
      active: database.activeGiveaways().length,
      updateIntervalMs: config.updateIntervalMs,
    });
  }

  async create(options) {
    if (database.countActive(options.guild.id) >= config.maxActiveGiveaways) {
      throw new Error(`This server already has the maximum of ${config.maxActiveGiveaways} active giveaways.`);
    }

    const now = Date.now();
    const id = giveawayId();
    const giveaway = {
      id,
      guild_id: options.guild.id,
      channel_id: options.channel.id,
      prize: options.prize,
      description: options.description || null,
      host_id: options.host.id,
      host_name: options.host.globalName || options.host.username,
      sponsor_id: options.sponsor?.id || null,
      winner_count: options.winnerCount,
      image_url: options.imageUrl || null,
      start_time: now,
      end_time: now + options.durationMs,
      created_by: options.createdBy.id,
      created_at: now,
    };
    const giveawayRequirements = {
      giveaway_id: id,
      required_role_id: options.requiredRoleId || null,
      bonus_role_id: options.bonusRoleId || null,
      bonus_entries: Math.max(0, options.bonusEntries || 0),
      blacklisted_role_id: options.blacklistedRoleId || null,
      allowed_role_ids: JSON.stringify(options.allowedRoleIds || []),
      minimum_account_age_ms: options.minimumAccountAgeMs || null,
      minimum_join_age_ms: options.minimumJoinAgeMs || null,
      required_messages: Math.max(0, options.requiredMessages || 0),
      booster_only: options.boosterOnly ? 1 : 0,
    };

    database.createGiveaway(giveaway, giveawayRequirements);
    let saved = database.getGiveaway(id);

    try {
      const message = await options.channel.send(
        renderer.giveawayPayload(saved, database.entryStats(id))
      );
      database.setMessage(id, message.id);
      saved = database.getGiveaway(id);
      this.scheduleEnd(saved);
      await logAction(this.client, saved, 'Created', options.createdBy.id, {
        note: `Created in <#${options.channel.id}>.`,
      });
      return saved;
    } catch (error) {
      database.cancel(id, options.createdBy.id);
      throw error;
    }
  }

  async enter(id, member) {
    const giveaway = this.requireGiveaway(id);
    this.requireActive(giveaway);
    if (giveaway.status === 'paused') throw new Error('This giveaway is paused.');

    const result = await requirements.evaluate(giveaway, member);
    if (!result.eligible) {
      const failed = result.checks.filter((check) => !check.passed).map((check) => check.label);
      throw new Error(`You are not eligible: ${failed.join(', ')}`);
    }

    database.addEntry(id, member.id, result.weight);
    await logAction(this.client, giveaway, 'Entered', member.id, {
      weight: result.weight,
      note: `${member.user.tag} entered with ${result.weight} weighted entry${result.weight === 1 ? '' : 'ies'}.`,
    });
    this.queueRefresh(id);
    return { weight: result.weight, stats: database.entryStats(id) };
  }

  async leave(id, member) {
    const giveaway = this.requireGiveaway(id);
    this.requireActive(giveaway);
    const entry = database.getEntry(id, member.id);
    if (!entry) throw new Error('You are not entered in this giveaway.');

    database.removeEntry(id, member.id);
    await logAction(this.client, giveaway, 'Left', member.id, {
      note: `${member.user.tag} left the giveaway.`,
    });
    this.queueRefresh(id);
    return database.entryStats(id);
  }

  async pause(id, actorId) {
    const giveaway = this.requireGiveaway(id);
    if (giveaway.status !== 'active') throw new Error('Only an active giveaway can be paused.');
    this.clearEndTimer(id);
    database.pause(id, Math.max(1000, giveaway.end_time - Date.now()));
    const updated = database.getGiveaway(id);
    await this.refresh(id);
    await logAction(this.client, updated, 'Paused', actorId);
    return updated;
  }

  async resume(id, actorId) {
    const giveaway = this.requireGiveaway(id);
    if (giveaway.status !== 'paused') throw new Error('This giveaway is not paused.');
    database.resume(id, Date.now() + Math.max(1000, giveaway.remaining_ms || 1000));
    const updated = database.getGiveaway(id);
    this.scheduleEnd(updated);
    await this.refresh(id);
    await logAction(this.client, updated, 'Resumed', actorId);
    return updated;
  }

  async edit(id, actorId, changes) {
    const giveaway = this.requireGiveaway(id);
    this.requireActive(giveaway);
    const update = {
      id,
      prize: changes.prize || null,
      description: changes.description === undefined ? null : changes.description,
      winner_count: changes.winnerCount || null,
      end_time: changes.durationMs ? Date.now() + changes.durationMs : null,
      image_url: changes.imageUrl || null,
    };
    database.updateBasics(update);
    database.updateRequirements({
      giveaway_id: id,
      required_role_id: changes.requiredRoleId || null,
      bonus_role_id: changes.bonusRoleId || null,
      bonus_entries: Number.isInteger(changes.bonusEntries) ? changes.bonusEntries : null,
      blacklisted_role_id: changes.blacklistedRoleId || null,
      allowed_role_ids: changes.allowedRoleIds ? JSON.stringify(changes.allowedRoleIds) : null,
      minimum_account_age_ms: changes.minimumAccountAgeMs || null,
      minimum_join_age_ms: changes.minimumJoinAgeMs || null,
      required_messages: Number.isInteger(changes.requiredMessages) ? changes.requiredMessages : null,
      booster_only: typeof changes.boosterOnly === 'boolean' ? Number(changes.boosterOnly) : null,
    });
    const updated = database.getGiveaway(id);
    if (updated.status === 'active') this.scheduleEnd(updated);
    await this.refresh(id);
    await logAction(this.client, updated, 'Edited', actorId);
    return updated;
  }

  async end(id, actorId = 'system') {
    if (this.runningEnds.has(id)) return database.getGiveaway(id);
    this.runningEnds.add(id);
    this.clearEndTimer(id);

    try {
      const giveaway = this.requireGiveaway(id);
      if (!['active', 'paused'].includes(giveaway.status)) {
        throw new Error('This giveaway has already ended.');
      }

      const validEntries = await this.validEntries(giveaway);
      const selected = pickWeighted(
        validEntries,
        giveaway.winner_count,
        new Set(),
        config.allowDuplicateWinners
      );
      for (const winner of selected) database.addWinner(id, winner.user_id, 0);
      database.end(id, actorId);

      const ended = database.getGiveaway(id);
      const winners = database.winners(id);
      const stats = database.entryStats(id);
      await this.refresh(id);
      await this.announce(ended, winners, stats, false);
      await logAction(this.client, ended, selected.length ? 'Ended' : 'No Valid Winner', actorId, {
        winners: selected.map((winner) => winner.user_id),
        entries: stats.users,
      });
      await this.dmWinners(ended, selected);
      return ended;
    } finally {
      this.runningEnds.delete(id);
    }
  }

  async reroll(id, actorId, winnerCount = null) {
    const giveaway = this.requireGiveaway(id);
    if (giveaway.status !== 'ended') throw new Error('Only ended giveaways can be rerolled.');

    const previous = database.winners(id);
    const excluded = config.allowPreviousWinnersOnReroll
      ? new Set()
      : new Set(previous.map((winner) => winner.user_id));
    const validEntries = await this.validEntries(giveaway);
    const selected = pickWeighted(
      validEntries,
      winnerCount || giveaway.winner_count,
      excluded,
      config.allowDuplicateWinners
    );
    if (!selected.length) throw new Error('No eligible entries are available for a reroll.');

    const rerollNumber = database.nextReroll(id);
    for (const winner of selected) database.addWinner(id, winner.user_id, rerollNumber);
    const stats = database.entryStats(id);
    await this.announce(giveaway, selected, stats, true);
    await logAction(this.client, giveaway, 'Rerolled', actorId, {
      winners: selected.map((winner) => winner.user_id),
      rerollNumber,
    });
    await this.dmWinners(giveaway, selected);
    return selected;
  }

  async delete(id, actorId) {
    const giveaway = this.requireGiveaway(id);
    if (!['active', 'paused'].includes(giveaway.status)) {
      throw new Error('Only active or paused giveaways can be cancelled.');
    }
    this.clearEndTimer(id);
    database.cancel(id, actorId);
    const cancelled = database.getGiveaway(id);
    await logAction(this.client, cancelled, 'Deleted', actorId);

    try {
      const message = await this.fetchMessage(cancelled);
      await message?.delete();
    } catch (error) {
      logger.warn('giveaway_message_delete_failed', {
        giveawayId: id,
        message: error.message,
      });
    }
    return cancelled;
  }

  async requirementStatus(id, member) {
    const giveaway = this.requireGiveaway(id);
    const result = await requirements.evaluate(giveaway, member);
    return {
      giveaway,
      ...result,
      entry: database.getEntry(id, member.id),
    };
  }

  list(guildId) {
    return database.activeByGuild(guildId);
  }

  listAll(guildId, limit = 25) {
    return database.allByGuild(guildId, limit);
  }

  async submitProof(id, interaction, imageUrl, note = null) {
    const giveaway = this.requireGiveaway(id);
    if (giveaway.guild_id !== interaction.guildId) {
      throw new Error('That giveaway belongs to a different server.');
    }

    const message = await interaction.channel.send(
      renderer.proofPayload(giveaway, {
        submittedBy: interaction.user.id,
        imageUrl,
        note,
      })
    );

    database.addProof({
      giveawayId: id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: message.id,
      submittedBy: interaction.user.id,
      imageUrl,
      note,
    });
    await logAction(this.client, giveaway, 'Proof Submitted', interaction.user.id, {
      channelId: interaction.channelId,
      messageId: message.id,
    });
    return message;
  }

  queueRefresh(id) {
    clearTimeout(this.refreshTimers.get(id));
    this.refreshTimers.set(id, setTimeout(() => {
      this.refreshTimers.delete(id);
      this.refresh(id).catch((error) => {
        logger.error('giveaway_refresh_failed', error, { giveawayId: id });
      });
    }, 750));
  }

  clearEndTimer(id) {
    const timer = this.endTimers.get(id);
    if (timer) clearTimeout(timer);
    this.endTimers.delete(id);
  }

  scheduleEnd(giveaway) {
    this.clearEndTimer(giveaway.id);
    if (giveaway.status !== 'active') return;

    const delay = Math.max(0, giveaway.end_time - Date.now());
    const maxTimeout = 2_147_000_000;
    const timer = setTimeout(() => {
      this.endTimers.delete(giveaway.id);

      if (delay > maxTimeout) {
        const current = database.getGiveaway(giveaway.id);
        if (current?.status === 'active') this.scheduleEnd(current);
        return;
      }

      this.end(giveaway.id, 'system').catch((error) => {
        logger.error('giveaway_exact_end_failed', error, { giveawayId: giveaway.id });
      });
    }, Math.min(delay, maxTimeout));

    timer.unref();
    this.endTimers.set(giveaway.id, timer);
  }

  async refresh(id) {
    const giveaway = database.getGiveaway(id);
    if (!giveaway?.message_id) return;
    const message = await this.fetchMessage(giveaway);
    if (!message) return;

    const payload = renderer.giveawayPayload(
      giveaway,
      database.entryStats(id),
      database.winners(id)
    );
    delete payload.flags;
    await message.edit(payload);
  }

  async tick() {
    const giveaways = database.activeGiveaways();
    for (const giveaway of giveaways) {
      try {
        if (giveaway.status === 'active' && giveaway.end_time <= Date.now()) {
          await this.end(giveaway.id, 'system');
        } else {
          await this.refresh(giveaway.id);
        }
      } catch (error) {
        logger.error('giveaway_tick_item_failed', error, { giveawayId: giveaway.id });
      }
    }
  }

  async validEntries(giveaway) {
    const guild = await this.client.guilds.fetch(giveaway.guild_id);
    const entries = database.entries(giveaway.id);
    const valid = [];

    for (const entry of entries) {
      try {
        const member = await guild.members.fetch(entry.user_id);
        const result = await requirements.evaluate(giveaway, member);
        if (result.eligible) valid.push({ ...entry, weight: result.weight });
      } catch {
        // Users who left the server are not valid winners.
      }
    }
    return valid;
  }

  async fetchMessage(giveaway) {
    try {
      const channel = await this.client.channels.fetch(giveaway.channel_id);
      if (!channel?.isTextBased()) return null;
      return await channel.messages.fetch(giveaway.message_id);
    } catch (error) {
      logger.warn('giveaway_message_missing', {
        giveawayId: giveaway.id,
        channelId: giveaway.channel_id,
        messageId: giveaway.message_id,
        message: error.message,
      });
      return null;
    }
  }

  async announce(giveaway, winners, stats, reroll) {
    try {
      const channel = await this.client.channels.fetch(giveaway.channel_id);
      if (!channel?.isTextBased()) return;
      await channel.send(renderer.announcementPayload(giveaway, winners, stats, reroll));
    } catch (error) {
      logger.error('giveaway_announcement_failed', error, { giveawayId: giveaway.id });
    }
  }

  async dmWinners(giveaway, winners) {
    if (!config.dmWinners) return;
    for (const winner of winners) {
      try {
        const user = await this.client.users.fetch(winner.user_id);
        await user.send(`You won **${giveaway.prize}** in giveaway \`${giveaway.id}\`!`);
      } catch (error) {
        await logAction(this.client, giveaway, 'Winner DM Failed', winner.user_id, {
          error: error.message,
        });
      }
    }
  }

  requireGiveaway(id) {
    const giveaway = database.getGiveaway(id);
    if (!giveaway) throw new Error('Giveaway not found.');
    return giveaway;
  }

  requireActive(giveaway) {
    if (!['active', 'paused'].includes(giveaway.status)) {
      throw new Error('This giveaway is no longer active.');
    }
  }
}

module.exports = new GiveawayManager();
