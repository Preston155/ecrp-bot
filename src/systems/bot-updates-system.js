const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

const DATA_PATH = path.join(__dirname, '..', 'data', 'bot-updates.json');
const PANELS_PATH = path.join(__dirname, '..', 'data', 'bot-update-panels.json');
const REFRESH_INTERVAL = 30_000;
let client = null;
let interval = null;
let lastModified = 0;

function divider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

async function loadUpdates() {
  const [raw, stat] = await Promise.all([
    fs.readFile(DATA_PATH, 'utf8'),
    fs.stat(DATA_PATH),
  ]);
  const data = JSON.parse(raw);
  data.updatedAt = new Date(stat.mtimeMs).toISOString();
  return data;
}

async function loadPanels() {
  try {
    const raw = await fs.readFile(PANELS_PATH, 'utf8');
    const data = raw.trim() ? JSON.parse(raw) : { guilds: {} };
    data.guilds ||= {};
    return data;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Bot update panel store failed:', error.message);
    return { guilds: {} };
  }
}

async function savePanels(data) {
  await fs.mkdir(path.dirname(PANELS_PATH), { recursive: true });
  await fs.writeFile(PANELS_PATH + '.tmp', JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(PANELS_PATH + '.tmp', PANELS_PATH);
}

function prettyDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function releaseText(release, staff) {
  const lines = [
    `## ✨ New Changes`,
    `-# ${prettyDate(release.date)} • ${release.title}`,
  ];
  for (const feature of release.features) {
    lines.push('', `**${feature.name}**`);
    lines.push(staff ? feature.staff : feature.public);
    if (staff && feature.commands?.length) {
      lines.push(feature.commands.map((command) => `\`${command}\``).join(' • '));
    }
  }
  return lines.join('\n');
}

async function payload(staff = false, ephemeral = true) {
  const data = await loadUpdates();
  const updatedUnix = Math.floor(new Date(data.updatedAt).getTime() / 1000);
  const container = new ContainerBuilder()
    .setAccentColor(staff ? 0xf59e0b : 0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      staff
        ? `# 🚀 ECRP Bot Updates\nNew features, improvements, and staff setup information.\n-# Last updated <t:${updatedUnix}:R>`
        : `# 🚀 ECRP Bot Updates\nA timeline of new features and improvements.\n-# Last updated <t:${updatedUnix}:R>`
    ));
  for (const release of data.releases) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(releaseText(release, staff)));
  }
  return {
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [container],
    allowedMentions: { parse: [] },
  };
}

async function postPanel(channel) {
  const panels = await loadPanels();
  const existing = panels.guilds[channel.guild.id];
  let message = null;
  if (existing) {
    const oldChannel = await channel.client.channels.fetch(existing.channelId).catch(() => null);
    if (oldChannel?.isTextBased()) {
      message = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
    }
  }

  const nextPayload = await payload(true, false);
  if (message) {
    const editPayload = { ...nextPayload };
    delete editPayload.flags;
    await message.edit(editPayload);
  } else {
    message = await channel.send(nextPayload);
  }
  panels.guilds[channel.guild.id] = {
    channelId: message.channel.id,
    messageId: message.id,
    updatedAt: new Date().toISOString(),
  };
  await savePanels(panels);
  return message;
}

async function refreshAll(force = false) {
  if (!client?.isReady()) return;
  const stat = await fs.stat(DATA_PATH).catch(() => null);
  if (!stat || (!force && stat.mtimeMs <= lastModified)) return;
  lastModified = stat.mtimeMs;

  const panels = await loadPanels();
  let changed = false;
  for (const [guildId, panel] of Object.entries(panels.guilds)) {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.isTextBased()
      ? await channel.messages.fetch(panel.messageId).catch(() => null)
      : null;
    if (!message) {
      delete panels.guilds[guildId];
      changed = true;
      continue;
    }
    const nextPayload = await payload(true, false);
    delete nextPayload.flags;
    await message.edit(nextPayload).catch((error) => {
      console.error('Bot update panel refresh failed:', error.message);
    });
  }
  if (changed) await savePanels(panels);
}

function initialize(nextClient) {
  client = nextClient;
  if (interval) clearInterval(interval);
  refreshAll(true).catch((error) => console.error('Bot update panel recovery failed:', error.message));
  interval = setInterval(() => {
    refreshAll().catch((error) => console.error('Bot update panel refresh failed:', error.message));
  }, REFRESH_INTERVAL);
  interval.unref();
  console.log('Bot update panels ready.');
}

module.exports = { payload, postPanel, refreshAll, initialize };
