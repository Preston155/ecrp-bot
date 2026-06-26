const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const database = require('../../database/db');
const { disabledStat, separator, text } = require('../../utils/componentsV2');
const { logger } = require('../../utils/logger');

function sessionId() {
  return `SSU-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function counts(id) {
  const votes = database.sessionVotes(id);
  return {
    votes,
    ready: votes.filter((vote) => vote.vote === 'ready'),
    out: votes.filter((vote) => vote.vote === 'out'),
  };
}

function progress(ready, target) {
  const percent = Math.min(100, Math.round((ready / Math.max(1, target)) * 100));
  const filled = Math.round(percent / 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent}%`;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Not available';
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

class SessionManager {
  constructor() {
    this.client = null;
    this.starting = new Set();
  }

  initialize(client) {
    this.client = client;
    for (const guild of client.guilds.cache.values()) {
      const session = database.activeSession(guild.id);
      if (session) this.recoverSession(session).catch((error) => {
        logger.warn('session_recovery_failed', { sessionId: session.id, message: error.message });
      });
    }
    logger.info('advanced_session_system_ready');
  }

  config(guildId) {
    const config = database.sessionConfig(guildId);
    const autoStartCount = Number.parseInt(process.env.SESSION_AUTO_START_COUNT || '', 10);
    const values = {
      serverName: config.server_name === 'ERLC Roleplay' ? process.env.SESSION_BRAND : null,
      gameCode: config.game_code === 'CityAngels' ? process.env.SESSION_GAME_CODE : null,
      serverOwner: config.server_owner === 'Preston' ? process.env.SESSION_SERVER_OWNER : null,
      autoStartCount: Number.isInteger(autoStartCount) && config.auto_start_count === 1
        ? autoStartCount
        : null,
    };
    if (values.serverName || values.gameCode || values.serverOwner || values.autoStartCount) {
      return this.updateConfig(guildId, values);
    }
    return config;
  }

  votePayload(session) {
    const stats = counts(session.id);
    const locked = session.status !== 'voting';
    const container = new ContainerBuilder()
      .setAccentColor(locked ? 0x2563eb : 0x22c55e)
      .addTextDisplayComponents(text(
        `# 📋 ECRP Session Vote
` +
        `**Host:** <@${session.host_id}> • **Need:** ${session.auto_start_count} ready
` +
        `${progress(stats.ready.length, session.auto_start_count)}`
      ))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        disabledStat(`session:ready-count:${session.id}`, `Ready: ${stats.ready.length}`, '✅'),
        disabledStat(`session:out-count:${session.id}`, `Out: ${stats.out.length}`, '❌')
      ))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`session:ready:${session.id}`).setLabel('Ready').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(locked),
        new ButtonBuilder().setCustomId(`session:out:${session.id}`).setLabel('Out').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(locked),
        new ButtonBuilder().setCustomId(`session:clear:${session.id}`).setLabel('Clear').setStyle(ButtonStyle.Secondary).setDisabled(locked),
        new ButtonBuilder().setCustomId(`session:roster:${session.id}`).setLabel('Roster').setStyle(ButtonStyle.Secondary)
      ));
    return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { users: [session.host_id], roles: [], parse: [] } };
  }

  startPayload(session, readyIds) {
    const readyMembers = readyIds.length
      ? readyIds.map((id) => `<@${id}>`).join(' ')
      : 'No members voted ready.';
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor(0x2563eb)
          .addTextDisplayComponents(text(
            `# 🚦 ECRP Session Started
` +
            `The server is open—join when ready.

` +
            `**Code:** \`${session.game_code}\`
` +
            `**Owner:** ${session.server_owner}
` +
            `**Host:** <@${session.host_id}>
` +
            `**Started:** <t:${Math.floor(session.started_at / 1000)}:R>`
          ))
          .addSeparatorComponents(separator())
          .addTextDisplayComponents(text(
            `**Ready Members (${readyIds.length})**
${readyMembers}`
          ))
          .addTextDisplayComponents(text(`-# Join promptly • Follow staff directions`)),
      ],
      allowedMentions: { parse: [] },
    };
  }

  endPayload(session, closedBy, attendance) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [new ContainerBuilder().setAccentColor(0xef4444).addTextDisplayComponents(text(
        `# 🏁 ECRP Session Ended
**Attendance:** ${attendance.length}
**Duration:** ${session.started_at && session.ended_at ? formatDuration(session.ended_at - session.started_at) : 'Not available'}
**Ended by:** <@${closedBy}>`
      ))],
      allowedMentions: { parse: [] },
    };
  }

  cancelPayload(session, cancelledBy) {
    return { flags: MessageFlags.IsComponentsV2, components: [new ContainerBuilder().setAccentColor(0x6b7280).addTextDisplayComponents(text(
      `# 🛑 Session Vote Cancelled
**By:** <@${cancelledBy}>`
    ))], allowedMentions: { parse: [] } };
  }

  rosterPayload(session) {
    const stats = counts(session.id);
    const ready = stats.ready.map((vote) => `<@${vote.user_id}>`).join(' ') || 'None';
    const out = stats.out.map((vote) => `<@${vote.user_id}>`).join(' ') || 'None';
    return { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(text(
      `## 👥 Roster
**Ready (${stats.ready.length}):** ${ready}
**Out (${stats.out.length}):** ${out}`
    ))], allowedMentions: { parse: [] } };
  }

  noticePayload(title, description, color = 0x5865f2, ephemeral = false) {
    return {
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [
        new ContainerBuilder()
          .setAccentColor(color)
          .addTextDisplayComponents(text(`## ${title}\n${description}`)),
      ],
      allowedMentions: { parse: [] },
    };
  }

  helpPayload(prefix = '-') {
    return { flags: MessageFlags.IsComponentsV2, components: [new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(text(
      `# 🚓 Session Commands
\`${prefix}sv\` vote • \`${prefix}ss\` start • \`${prefix}se\` end
\`${prefix}session status\` • \`${prefix}session roster\` • \`${prefix}session history\`
\`${prefix}session cancel\` • \`${prefix}session attendance add/remove @member\``
    ))], allowedMentions: { parse: [] } };
  }

  statusPayload(session) {
    const stats = counts(session.id);
    const active = session.status === 'active';
    return { flags: MessageFlags.IsComponentsV2, components: [new ContainerBuilder()
      .setAccentColor(active ? 0x2563eb : 0x22c55e)
      .addTextDisplayComponents(text(`# 📡 Session Status
**${active ? 'Active' : 'Voting'}** • Host <@${session.host_id}>${active ? ` • ${formatDuration(Date.now() - session.started_at)}` : ''}`))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        disabledStat(`session:status-ready:${session.id}`, `Ready: ${stats.ready.length}`, '✅'),
        disabledStat(`session:status-out:${session.id}`, `Out: ${stats.out.length}`, '❌')
      ))], allowedMentions: { parse: [] } };
  }

  configPayload(config) {
    return { flags: MessageFlags.IsComponentsV2, components: [new ContainerBuilder().setAccentColor(0x22c55e).addTextDisplayComponents(text(
      `# ⚙️ Session Setup Saved
**Code:** \`${config.game_code}\` • **Owner:** ${config.server_owner}
**Auto-start:** ${config.auto_start_count} • **Logs:** ${config.log_channel_id ? `<#${config.log_channel_id}>` : 'None'}`
    ))], allowedMentions: { parse: [] } };
  }

  async create(message) {
    const existing = database.activeSession(message.guildId);
    if (existing) throw new Error('This server already has an open session.');
    const config = this.config(message.guildId);
    const session = {
      id: sessionId(),
      guild_id: message.guildId,
      channel_id: message.channelId,
      host_id: message.author.id,
      server_name: config.server_name,
      game_code: config.game_code,
      server_owner: config.server_owner,
      auto_start_count: config.auto_start_count,
      created_at: Date.now(),
    };
    database.createSession(session);
    const saved = database.session(session.id);
    let voteMessage;
    try {
      voteMessage = await message.channel.send(this.votePayload(saved));
    } catch (error) {
      database.deleteSession(session.id);
      throw error;
    }
    database.setSessionMessage(session.id, voteMessage.id);
    await message.delete().catch(() => null);
    logger.info('session_vote_created', { sessionId: session.id, guildId: message.guildId });
    return database.session(session.id);
  }

  async vote(sessionIdValue, member, vote) {
    const session = database.session(sessionIdValue);
    if (!session || session.status !== 'voting') throw new Error('This session vote is closed.');
    if (member.user?.bot) throw new Error('Bots cannot participate in session votes.');
    database.setSessionVote(session.id, member.id, vote);
    await this.refreshVote(session);
    const stats = counts(session.id);
    if (vote === 'ready' && stats.ready.length >= session.auto_start_count) {
      await this.start(session.guild_id, member.id, true);
    }
    return stats;
  }

  async clearVote(sessionIdValue, userId) {
    const session = database.session(sessionIdValue);
    if (!session || session.status !== 'voting') throw new Error('This session vote is closed.');
    database.removeSessionVote(session.id, userId);
    await this.refreshVote(session);
  }

  async start(guildId, actorId, automatic = false) {
    const session = database.activeSession(guildId);
    if (!session) throw new Error('There is no open session.');
    if (session.status === 'active') throw new Error('The session is already active.');
    if (this.starting.has(session.id)) return session;
    this.starting.add(session.id);
    try {
      const stats = counts(session.id);
      const readyIds = stats.ready.map((vote) => vote.user_id);
      for (const id of readyIds) database.addAttendance(session.id, id);
      database.setSessionStatus({
        id: session.id,
        status: 'active',
        started_at: Date.now(),
        ended_at: null,
        ended_by: null,
      });
      const updated = database.session(session.id);
      await this.refreshVote(updated);
      const channel = await this.client.channels.fetch(updated.channel_id);
      const notifiedIds = [...new Set([updated.host_id, ...readyIds])];
      await channel.send({
        content: `🚨 **ECRP session starting now!** ${notifiedIds.map((id) => `<@${id}>`).join(' ')}`,
        allowedMentions: { users: notifiedIds, roles: [], parse: [] },
      });
      await channel.send(this.startPayload(updated, readyIds));
      await this.log(updated.guild_id, this.startPayload(updated, []));
      logger.info('session_started', {
        sessionId: updated.id,
        actorId,
        automatic,
        ready: readyIds.length,
      });
      return updated;
    } finally {
      this.starting.delete(session.id);
    }
  }

  async end(guildId, actorId) {
    const session = database.activeSession(guildId);
    if (!session) throw new Error('There is no open session.');
    if (session.status !== 'active') {
      throw new Error('This session has not started. Use `-session cancel` to close the vote.');
    }
    database.setSessionStatus({
      id: session.id,
      status: 'ended',
      started_at: null,
      ended_at: Date.now(),
      ended_by: actorId,
    });
    const ended = database.session(session.id);
    const attendance = database.sessionAttendance(session.id);
    await this.refreshVote(ended);
    const channel = await this.client.channels.fetch(ended.channel_id);
    const payload = this.endPayload(ended, actorId, attendance);
    await channel.send(payload);
    await this.log(ended.guild_id, payload);
    logger.info('session_ended', { sessionId: ended.id, actorId, attendance: attendance.length });
    return ended;
  }

  async cancel(guildId, actorId) {
    const session = database.activeSession(guildId);
    if (!session) throw new Error('There is no open session.');
    if (session.status !== 'voting') throw new Error('An active patrol must be ended, not cancelled.');
    database.setSessionStatus({
      id: session.id,
      status: 'cancelled',
      started_at: null,
      ended_at: Date.now(),
      ended_by: actorId,
    });
    const cancelled = database.session(session.id);
    await this.refreshVote(cancelled);
    const channel = await this.client.channels.fetch(cancelled.channel_id).catch(() => null);
    const payload = this.cancelPayload(cancelled, actorId);
    if (channel?.isTextBased()) await channel.send(payload);
    await this.log(cancelled.guild_id, payload);
    logger.info('session_cancelled', { sessionId: cancelled.id, actorId });
    return cancelled;
  }

  async adjustAttendance(guildId, userId, action, actorId) {
    const session = database.activeSession(guildId);
    if (!session || session.status !== 'active') throw new Error('There is no active patrol.');
    if (action === 'add') {
      database.addAttendance(session.id, userId, 'manual');
    } else if (action === 'remove') {
      database.removeAttendance(session.id, userId);
    } else {
      throw new Error('Attendance action must be `add` or `remove`.');
    }
    logger.info('session_attendance_adjusted', { sessionId: session.id, userId, action, actorId });
    return database.sessionAttendance(session.id);
  }

  async recoverSession(session) {
    const channel = await this.client.channels.fetch(session.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const existing = session.vote_message_id
      ? await channel.messages.fetch(session.vote_message_id).catch(() => null)
      : null;
    if (existing) {
      await this.refreshVote(session);
      return;
    }
    const replacement = await channel.send(this.votePayload(session));
    database.setSessionMessage(session.id, replacement.id);
    logger.info('session_vote_recovered', { sessionId: session.id, messageId: replacement.id });
  }

  async refreshVote(session) {
    if (!session.vote_message_id) return;
    const channel = await this.client.channels.fetch(session.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(session.vote_message_id).catch(() => null);
    if (!message) return;
    const payload = this.votePayload(database.session(session.id));
    delete payload.flags;
    await message.edit(payload);
  }

  async log(guildId, payload) {
    const config = this.config(guildId);
    if (!config.log_channel_id) return;
    const channel = await this.client.channels.fetch(config.log_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const safePayload = { ...payload, allowedMentions: { parse: [] } };
    await channel.send(safePayload).catch(() => null);
  }

  updateConfig(guildId, values) {
    return database.updateSessionConfig({
      guild_id: guildId,
      log_channel_id: values.logChannelId || null,
      server_name: values.serverName || null,
      game_code: values.gameCode || null,
      server_owner: values.serverOwner || null,
      auto_start_count: Number.isInteger(values.autoStartCount) ? values.autoStartCount : null,
    });
  }

  historyPayload(guildId) {
    const sessions = database.recentSessions(guildId, 10);
    const lines = sessions.length
      ? sessions.map((session) => {
        const attendance = database.sessionAttendance(session.id).length;
        const duration = session.started_at && session.ended_at
          ? ` • ${formatDuration(session.ended_at - session.started_at)}`
          : '';
        return `\`${session.id}\` **${session.status.toUpperCase()}** • ${attendance} attended${duration} • <t:${Math.floor(session.created_at / 1000)}:R>`;
      })
      : ['No sessions have been recorded.'];
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder().setAccentColor(0x5865f2)
          .addTextDisplayComponents(text(`## 📚 Session History\n${lines.join('\n')}`)),
      ],
      allowedMentions: { parse: [] },
    };
  }

  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('session:')) return false;
    const [, action, id] = interaction.customId.split(':');
    try {
      if (action === 'roster') {
        const current = database.session(id);
        if (!current) throw new Error('Session not found.');
        await interaction.reply(this.rosterPayload(current));
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (action === 'ready' || action === 'out') {
        const stats = await this.vote(id, interaction.member, action);
        const payload = this.noticePayload(
          action === 'ready' ? '✅ Ready for Patrol' : '❌ Marked Out',
          action === 'ready'
            ? `Your vote is locked in.\n**Ready members:** ${stats.ready.length}`
            : 'Your status has been updated for this session vote.',
          action === 'ready' ? 0x22c55e : 0xef4444
        );
        delete payload.flags;
        await interaction.editReply(payload);
      } else if (action === 'clear') {
        await this.clearVote(id, interaction.user.id);
        const payload = this.noticePayload(
          '🧹 Vote Cleared',
          'Your Ready/Out selection has been removed.',
          0x6b7280
        );
        delete payload.flags;
        await interaction.editReply(payload);
      }
    } catch (error) {
      const payload = this.noticePayload(
        '❌ Session Error',
        error.message || 'The session action failed.',
        0xef4444,
        true
      );
      if (interaction.deferred || interaction.replied) {
        delete payload.flags;
        await interaction.editReply(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
    return true;
  }
}

module.exports = new SessionManager();
