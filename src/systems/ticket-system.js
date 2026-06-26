const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder
} = require("discord.js");

const STORE_PATH = path.join(__dirname, "..", "data", "tickets.json");
const TRANSCRIPT_DIR = path.join(__dirname, "..", "data", "transcripts");
const PUBLIC_TRANSCRIPT_DIR = process.env.TICKET_PUBLIC_TRANSCRIPT_DIR || process.env.TRANSCRIPT_PUBLIC_DIR || "/root/bots/bot6/src/data/transcripts";
const TRANSCRIPT_PUBLIC_BASE_URL = (process.env.TICKET_TRANSCRIPT_PUBLIC_BASE_URL || process.env.TRANSCRIPT_PUBLIC_BASE_URL || "https://api.prestonhq.com/transcripts").replace(/\/+$/, "");
const PANEL_IMAGE_PATH = path.join(__dirname, "..", "assets", "ticket-panel.png");

const CONFIG = {
  STAFF_ROLE_ID: process.env.TICKET_STAFF_ROLE_ID || process.env.STAFF_ROLE_ID || "",
  TICKET_CATEGORY_ID: process.env.TICKET_CATEGORY_ID || "",
  TICKET_LOG_CHANNEL_ID: process.env.TICKET_LOG_CHANNEL_ID || process.env.ORDER_LOG_CHANNEL_ID || "",
  TRANSCRIPT_LOG_CHANNEL_ID: process.env.TICKET_TRANSCRIPT_LOG_CHANNEL_ID || process.env.TRANSCRIPT_LOG_CHANNEL_ID || "",
  REVIEW_LOG_CHANNEL_ID: process.env.TICKET_REVIEW_LOG_CHANNEL_ID || ""
};

const SERVICES = {
  support: { label: "Support", emoji: "🎫", description: "General questions or help with ECRP." },
  partnership: { label: "Partnership", emoji: "🤝", description: "Partnership requests and community relations." },
  player: { label: "Player Report", emoji: "🚨", description: "Report a player or roleplay rule violation." },
  staff: { label: "Staff Report", emoji: "🛡️", description: "Privately report a staff concern." },
  appeal: { label: "Ban Appeal", emoji: "📨", description: "Appeal a ban or moderation action." },
  other: { label: "Other", emoji: "🧾", description: "Anything that does not fit another category." }
};

const STATUS_META = {
  Open: { emoji: "🟡", color: 0xfacc15 },
  Claimed: { emoji: "🟢", color: 0x22c55e },
  Pending: { emoji: "📌", color: 0xf59e0b },
  "In Progress": { emoji: "📦", color: 0x60a5fa },
  Completed: { emoji: "✅", color: 0x22c55e },
  Closed: { emoji: "🔴", color: 0x64748b }
};

const claimLocks = new Set();
let storeMutation = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function discordTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const unix = Math.floor(timestamp / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJson(file, fallback);
      return fallback;
    }
    console.error("Ticket JSON read failed:", error.message);
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

let storeCache = null;
let persistTimer = null;
let persistChain = Promise.resolve();

function normalizeStore(store) {
  if (!store || typeof store !== 'object') store = {};
  if (!store.tickets || typeof store.tickets !== 'object') store.tickets = {};
  if (!store.reviews || typeof store.reviews !== 'object') store.reviews = {};
  if (!store.settings || typeof store.settings !== 'object') store.settings = {};
  return store;
}

async function readStore() {
  if (storeCache) return storeCache;
  storeCache = normalizeStore(await readJson(STORE_PATH, { tickets: {}, reviews: {}, settings: {} }));
  return storeCache;
}

function queuePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = JSON.stringify(storeCache, null, 2) + '\n';
    persistChain = persistChain.then(async () => {
      await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
      await fs.writeFile(STORE_PATH + '.tmp', snapshot, 'utf8');
      await fs.rename(STORE_PATH + '.tmp', STORE_PATH);
    }).catch((error) => console.error('Ticket store save failed:', error.message));
  }, 25);
  persistTimer.unref?.();
}

async function flushStore() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    const snapshot = JSON.stringify(storeCache, null, 2) + '\n';
    persistChain = persistChain.then(async () => {
      await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
      await fs.writeFile(STORE_PATH + '.tmp', snapshot, 'utf8');
      await fs.rename(STORE_PATH + '.tmp', STORE_PATH);
    });
  }
  await persistChain;
}

function mutateStore(mutator) {
  const operation = storeMutation.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    queuePersist();
    return result;
  });
  storeMutation = operation.catch(() => null);
  return operation;
}

async function setGuildChannel(guildId, type, channelId) {
  if (!['rating', 'log', 'support'].includes(type)) throw new Error('Unknown ticket setting.');
  return mutateStore((store) => {
    store.settings[guildId] ||= {};
    const key = type === 'rating' ? 'ratingChannelId' : type === 'log' ? 'logChannelId' : 'supportRoleId';
    store.settings[guildId][key] = channelId;
    store.settings[guildId].updatedAt = nowIso();
    return { ...store.settings[guildId] };
  });
}

async function guildSettings(guildId) {
  const store = await readStore();
  return store.settings[guildId] || {};
}

async function ticketLogChannelId(guildId) {
  const settings = await guildSettings(guildId);
  return settings.logChannelId || CONFIG.TICKET_LOG_CHANNEL_ID || CONFIG.TRANSCRIPT_LOG_CHANNEL_ID;
}

async function ratingLogChannelId(guildId) {
  const settings = await guildSettings(guildId);
  return settings.ratingChannelId || CONFIG.REVIEW_LOG_CHANNEL_ID || await ticketLogChannelId(guildId);
}

async function saveTicket(ticket) {
  return mutateStore((store) => {
    store.tickets[ticket.channelId] = { ...ticket, updatedAt: nowIso() };
    return store.tickets[ticket.channelId];
  });
}

async function getTicket(channelId) {
  const store = await readStore();
  return store.tickets[channelId] || null;
}

async function removeTicket(channelId) {
  return mutateStore((store) => {
    delete store.tickets[channelId];
  });
}

async function findOpenTicket(guild, userId) {
  const store = await readStore();
  for (const ticket of Object.values(store.tickets)) {
    if (ticket.guildId !== guild.id || ticket.userId !== userId || ticket.status === "Closed") continue;
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (channel) return ticket;
    delete store.tickets[ticket.channelId];
  }
  await writeJson(STORE_PATH, store);
  return null;
}

function cleanChannelName(username) {
  const base = String(username || "user").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return "ticket-" + (base || "user").slice(0, 70);
}

function ticketChannelName(ticket, fallbackUsername) {
  const base = cleanChannelName(ticket?.username || fallbackUsername || "user");
  if (ticket?.status === "Closed") return "🔴・" + base;
  if (ticket?.status === "Completed") return "✅・" + base;
  if (ticket?.claimedBy) return "🟢・" + base;
  if (ticket?.status === "Pending") return "🟠・" + base;
  return "🟡・" + base;
}

function serviceText(serviceKey) {
  const service = SERVICES[serviceKey] || SERVICES.other;
  return service.emoji + " " + service.label;
}

function ticketTitle(serviceKey) {
  const service = SERVICES[serviceKey] || SERVICES.other;
  return service.emoji + " ECRP " + service.label + " Ticket";
}

function ticketFormat(serviceKey) {
  const formats = {
    support: ["**Support Request Format**", "• What do you need help with?", "• Relevant username(s)", "• Screenshots or details, if applicable"],
    partnership: ["**Partnership Application Format**", "• Community/server name:", "• Member count:", "• Permanent invite link:", "• Your role/position:", "• What can your community offer ECRP?", "• What do you expect from the partnership?", "• Any additional information:"],
    player: ["**Player Report Format**", "• Reported user:", "• Rule(s) broken:", "• Date and approximate time:", "• Evidence (screenshots/clips):", "• Additional context:"],
    staff: ["**Staff Report Format**", "• Staff member:", "• What happened?", "• Date and approximate time:", "• Evidence (screenshots/clips):", "• Additional context:"],
    appeal: ["**Ban Appeal Format**", "• Roblox/Discord username:", "• Punishment received:", "• Reason provided:", "• Why should it be reconsidered?", "• What will you do differently?"],
    other: ["**Other Request Format**", "• What is your request about?", "• Relevant username(s):", "• Useful details or evidence:"],
  };
  return (formats[serviceKey] || formats.other).join("\n");
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  return Boolean(CONFIG.STAFF_ROLE_ID && member.roles?.cache?.has(CONFIG.STAFF_ROLE_ID));
}

async function isTicketStaff(member) {
  if (isStaff(member)) return true;
  const settings = await guildSettings(member?.guild?.id);
  return Boolean(settings.supportRoleId && member?.roles?.cache?.has(settings.supportRoleId));
}

function divider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function componentPayload(container, extra = {}) {
  const allowedUserIds = [...new Set((extra.allowedUserIds || []).filter(Boolean).map(String))];
  const payload = {
    ...extra,
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { users: allowedUserIds, roles: [], parse: [] }
  };
  delete payload.allowedUserIds;
  return payload;
}

function ticketPanelPayload() {
  return componentPayload(buildTicketPanelContainer());
}

function buildTicketPanelContainer() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("ticket:select")
    .setPlaceholder("Open an ECRP ticket")
    .addOptions(Object.entries(SERVICES).map(([value, service]) => ({
      label: service.label,
      value,
      description: service.description.slice(0, 100),
      emoji: service.emoji
    })));

  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "# 🎟️ ECRP Support Center\n" +
      "Need assistance? Open a private ticket and the right staff team will take it from there."
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## Choose Your Department\n" +
      "🎫 **Support** — Questions and general help\n" +
      "🤝 **Partnership** — Community and partnership requests\n" +
      "🚨 **Player Report** — Report rule violations\n" +
      "🛡️ **Staff Report** — Private staff concerns\n" +
      "📨 **Ban Appeal** — Appeal a moderation action\n" +
      "🧾 **Other** — Anything not listed above"
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "**Before opening a ticket**\n" +
      "Have usernames, screenshots, clips, or other useful details ready."
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "-# 🔒 Private and secure • One open ticket per member • Misuse may result in moderation"
    ));
}
function buildTicketContainer(ticket) {
  const status = STATUS_META[ticket.status] || STATUS_META.Open;
  const claimedBy = ticket.claimedBy ? "<@" + ticket.claimedBy + ">" : "Nobody";
  const createdUnix = Math.floor(new Date(ticket.createdAt).getTime() / 1000);
  return new ContainerBuilder()
    .setAccentColor(status.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## " + status.emoji + " " + ticketTitle(ticket.service) + "\n" +
      "**Category:** " + serviceText(ticket.service) + "\n" +
      "**User:** <@" + ticket.userId + ">\n" +
      "**Status:** " + ticket.status + "\n" +
      "**Claimed by:** " + claimedBy + "\n" +
      "**Created:** <t:" + createdUnix + ":F>"
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      ticketFormat(ticket.service) + "\n\n" +
      "> Copy the format above, fill it out, and send it in this channel."
    ))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      ticket.claimedBy
        ? new ButtonBuilder().setCustomId("ticket:unclaim").setLabel("Unclaim").setEmoji("🔓").setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ticket:status:Completed").setLabel("Completed").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    ));
}
function buildCloseConfirmContainer(ticket) {
  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## 🔒 Close Ticket?\nAre you sure you want to close this ticket for <@" + ticket.userId + ">?\n\nA transcript and close summary will be logged."
    ))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket:close-confirm").setLabel("Confirm Close").setEmoji("✅").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ticket:close-cancel").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Secondary)
    ));
}

function buildReviewContainer(ticket) {
  return new ContainerBuilder()
    .setAccentColor(0xffc857)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## ⭐ Ticket Review\nThanks for using **ECRP** support. How was your ticket experience?\n\n**Ticket ID:** " + ticket.channelId + "\n**Category:** " + serviceText(ticket.service)
    ))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((rating) => new ButtonBuilder()
        .setCustomId("ticket:review:" + rating + ":" + ticket.guildId + ":" + ticket.channelId + ":" + ticket.userId)
        .setLabel(String(rating))
        .setEmoji("⭐")
        .setStyle(rating >= 4 ? ButtonStyle.Success : rating === 3 ? ButtonStyle.Secondary : ButtonStyle.Danger))
    ));
}

async function sendTicketPanel(channel) {
  return channel.send(ticketPanelPayload());
}

async function syncTicketChannelName(guild, ticket) {
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (channel?.manageable) {
    const nextName = ticketChannelName(ticket);
    if (channel.name !== nextName) await channel.setName(nextName, "Ticket status indicator update").catch(() => null);
  }
}

async function editTicketPanel(guild, ticket) {
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased() || !ticket.panelMessageId) return;
  const message = await channel.messages.fetch(ticket.panelMessageId).catch(() => null);
  if (message) await message.edit(componentPayload(buildTicketContainer(ticket), { allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean) })).catch(() => null);
}

async function sendLog(guild, title, ticket, details = "") {
  const channelId = await ticketLogChannelId(guild.id);
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const container = new ContainerBuilder()
    .setAccentColor(0x38bdf8)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## " + title + "\n" +
      "**Ticket ID:** " + (ticket.channelId ? "<#" + ticket.channelId + ">" : "Unknown") + "\n" +
      "**User:** <@" + ticket.userId + ">\n" +
      "**Category:** " + serviceText(ticket.service) + "\n" +
      "**Status:** " + ticket.status + "\n" +
      "**Claimed by:** " + (ticket.claimedBy ? "<@" + ticket.claimedBy + ">" : "Nobody") +
      (details ? "\n**Details:** " + details : "")
    ));
  await channel.send(componentPayload(container, { allowedUserIds: [] })).catch(() => null);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function mentionName(message, id) {
  const user = message.mentions?.users?.get?.(id);
  const member = message.mentions?.members?.get?.(id);
  return member?.displayName || user?.globalName || user?.username || id;
}

function resolveMentions(value, message) {
  let content = escapeHtml(value || "");
  content = content.replace(/&lt;@!?(\\d+)&gt;/g, (_m, id) => '<span class="mention">@' + escapeHtml(mentionName(message, id)) + '</span>');
  content = content.replace(/&lt;#(\\d+)&gt;/g, (_m, id) => '<span class="mention">#' + escapeHtml(message.guild?.channels?.cache?.get(id)?.name || id) + '</span>');
  content = content.replace(/&lt;@&(\\d+)&gt;/g, (_m, id) => '<span class="mention">@' + escapeHtml(message.guild?.roles?.cache?.get(id)?.name || ("role-" + id)) + '</span>');
  return content;
}

function renderV2Component(component, message) {
  const raw = component?.toJSON ? component.toJSON() : component;
  if (!raw) return "";
  if (raw.items?.length) {
    return '<div class="media-gallery">' + raw.items.map((item) => {
      const url = item.media?.url || item.url || item.src;
      if (!url) return '';
      return '<a href="' + escapeHtml(url) + '" target="_blank"><img src="' + escapeHtml(url) + '" alt="Component media"></a>';
    }).join("") + '</div>';
  }
  if (raw.components?.length) {
    const children = raw.components.map((child) => renderV2Component(child, message)).join("");
    if (raw.type === 17) return '<div class="v2-card">' + children + '</div>';
    if (raw.type === 9) return '<div class="v2-section">' + children + '</div>';
    return '<div class="component-row">' + children + '</div>';
  }
  if (raw.type === 10) return '<div class="v2-text">' + resolveMentions(raw.content || "", message).replace(/\n/g, "<br>") + '</div>';
  if (raw.type === 14) return '<div class="v2-separator"></div>';
  if (raw.type === 2) return '<span class="component-pill">' + escapeHtml((raw.emoji?.name ? raw.emoji.name + " " : "") + (raw.label || raw.customId || "Button")) + '</span>';
  if (raw.type === 3) return '<span class="component-pill">' + escapeHtml(raw.placeholder || "Dropdown") + '</span>';
  return '<span class="component-pill">Component ' + escapeHtml(raw.type) + '</span>';
}

function renderEmbeds(message) {
  if (!message.embeds?.length) return "";
  return '<div class="embeds">' + message.embeds.map((embed) => {
    const color = typeof embed.color === "number" ? "#" + embed.color.toString(16).padStart(6, "0") : "#5865f2";
    const author = embed.author?.name ? '<div class="embed-author">' + escapeHtml(embed.author.name) + '</div>' : "";
    const title = embed.title ? '<div class="embed-title">' + escapeHtml(embed.title) + '</div>' : "";
    const desc = embed.description ? '<div class="embed-desc">' + resolveMentions(embed.description, message).replace(/\n/g, "<br>") + '</div>' : "";
    const fields = embed.fields?.length ? '<div class="embed-fields">' + embed.fields.map((f) => '<div><b>' + escapeHtml(f.name) + '</b><span>' + resolveMentions(f.value, message).replace(/\n/g, "<br>") + '</span></div>').join("") + '</div>' : "";
    const thumb = embed.thumbnail?.url ? '<img class="embed-thumb" src="' + escapeHtml(embed.thumbnail.url) + '" alt="">' : "";
    const image = embed.image?.url ? '<img class="embed-image" src="' + escapeHtml(embed.image.url) + '" alt="">' : "";
    const footer = embed.footer?.text ? '<div class="embed-footer">' + escapeHtml(embed.footer.text) + '</div>' : "";
    return '<div class="embed-full" style="--embed-color:' + color + '"><div class="embed-body"><div>' + author + title + desc + fields + footer + '</div>' + thumb + '</div>' + image + '</div>';
  }).join("") + '</div>';
}

async function generateTranscript(channel, ticket) {
  const fetchedMessages = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const fetched = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!fetched?.size) break;
    fetchedMessages.push(...fetched.values());
    before = fetched.last()?.id;
    if (fetched.size < 100) break;
  }
  fetchedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const rows = fetchedMessages.map((message) => {
    const author = message.author;
    const name = escapeHtml(author?.globalName || author?.username || author?.tag || "Unknown");
    const tag = escapeHtml(author?.tag || author?.id || "unknown");
    const avatar = author?.displayAvatarURL?.({ extension: "png", size: 64 }) || "";
    const content = resolveMentions(message.content || "", message).replace(/\n/g, "<br>") || '<span class="muted">No text content</span>';
    const attachments = message.attachments?.size ? '<div class="attachments">' + [...message.attachments.values()].map((a) => {
      const url = escapeHtml(a.url);
      const name = escapeHtml(a.name || "Attachment");
      const isImage = /^image\//.test(a.contentType || "") || /\.(png|jpe?g|gif|webp)$/i.test(a.name || "");
      return '<a href="' + url + '" target="_blank">' + (isImage ? '<img src="' + url + '" alt="' + name + '">' : name) + '</a>';
    }).join("") + '</div>' : "";
    const components = message.components?.length ? '<div class="components-v2">' + message.components.map((c) => renderV2Component(c, message)).join("") + '</div>' : "";
    return '<article class="msg"><img class="avatar" src="' + escapeHtml(avatar) + '" alt=""><div class="bubble"><div class="meta"><strong>' + name + '</strong><span>' + tag + '</span><time>' + message.createdAt.toLocaleString("en-US", { timeZone: "America/New_York" }) + '</time></div><div class="content">' + content + '</div>' + attachments + renderEmbeds(message) + components + '</div></article>';
  }).join("\n");
  const id = String(ticket.channelId + "-" + Date.now()).replace(/[^a-zA-Z0-9_-]/g, "");
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket Transcript</title><style>:root{color-scheme:dark;--bg:#05070f;--panel:#101421;--text:#f8fafc;--muted:#9ca3af;--line:rgba(255,255,255,.1)}body{margin:0;background:radial-gradient(circle at top left,#1b2240,#05070f 42%);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}.wrap{max-width:1080px;margin:auto;padding:28px 16px}.hero,.messages{border:1px solid var(--line);background:rgba(16,20,33,.88);border-radius:18px;padding:18px;box-shadow:0 18px 45px rgba(0,0,0,.35)}.hero h1{margin:0 0 8px}.hero p{color:#cbd5e1}.messages{margin-top:18px}.msg{display:flex;gap:12px;padding:14px;border-radius:14px}.msg:hover{background:rgba(255,255,255,.035)}.avatar{width:42px;height:42px;border-radius:50%;background:#111827}.meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:12px}.meta strong{color:#fff;font-size:15px}.content{margin-top:4px;line-height:1.5}.mention{background:rgba(88,101,242,.25);color:#c7d2fe;border-radius:5px;padding:0 4px}.attachments,.embeds,.components-v2{display:grid;gap:8px;margin-top:10px}.attachments a{color:#7dd3fc}.attachments img,.media-gallery img{max-width:520px;max-height:320px;border-radius:10px;border:1px solid var(--line);display:block}.embed-full,.v2-card{border:1px solid var(--line);border-left:4px solid var(--embed-color,#5865f2);background:rgba(8,12,25,.82);border-radius:10px;padding:10px;max-width:720px}.embed-body{display:flex;gap:12px;align-items:flex-start}.embed-author,.embed-footer{color:var(--muted);font-size:12px}.embed-title{font-weight:800}.embed-desc{margin-top:5px}.embed-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px}.embed-fields div{display:grid;background:rgba(255,255,255,.025);border-radius:8px;padding:7px}.embed-image{max-width:100%;max-height:380px;border-radius:8px;margin-top:8px}.embed-thumb{max-width:92px;max-height:92px;border-radius:8px}.v2-section{display:grid;gap:8px}.v2-text{line-height:1.5}.v2-separator{height:1px;background:rgba(255,255,255,.14);margin:7px 0}.component-row{display:flex;flex-wrap:wrap;gap:7px}.component-pill{display:inline-flex;border:1px solid rgba(255,255,255,.12);background:rgba(88,101,242,.18);border-radius:8px;padding:6px 9px}.media-gallery{display:grid;gap:8px}.muted{color:var(--muted)}</style></head><body><main class="wrap"><section class="hero"><h1>📄 Ticket Transcript</h1><p><b>Ticket:</b> ' + escapeHtml(channel.name) + '</p><p><b>User:</b> &lt;@' + escapeHtml(ticket.userId) + '&gt; • <b>Category:</b> ' + escapeHtml(serviceText(ticket.service)) + ' • <b>Status:</b> ' + escapeHtml(ticket.status) + '</p></section><section class="messages">' + (rows || '<p class="muted">No messages found.</p>') + '</section></main></body></html>';
  await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });
  const filePath = path.join(TRANSCRIPT_DIR, id + ".html");
  await fs.writeFile(filePath, html, "utf8");
  let publicUrl = TRANSCRIPT_PUBLIC_BASE_URL + "/" + id + ".html";
  let publicFilePath = null;
  try {
    await fs.mkdir(PUBLIC_TRANSCRIPT_DIR, { recursive: true });
    publicFilePath = path.join(PUBLIC_TRANSCRIPT_DIR, id + ".html");
    await fs.writeFile(publicFilePath, html, "utf8");
  } catch (error) {
    console.error("Public transcript write failed:", error.message);
    publicUrl = null;
  }
  return { id, filePath, publicFilePath, publicUrl, count: fetchedMessages.length };
}

async function sendTranscriptLog(guild, ticket, transcript) {
  const channelId = CONFIG.TRANSCRIPT_LOG_CHANNEL_ID || await ticketLogChannelId(guild.id);
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const file = new AttachmentBuilder(transcript.filePath, { name: "ticket-transcript-" + transcript.id + ".html" });
  const linkLine = transcript.publicUrl ? "\n**Hosted:** " + transcript.publicUrl : "\n**Hosted:** Failed to publish public link";
  const container = new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## 📄 Transcript Saved\n" +
      "**User:** <@" + ticket.userId + ">\n" +
      "**Category:** " + serviceText(ticket.service) + "\n" +
      "**Messages:** " + transcript.count + "\n" +
      "**Created:** " + discordTime(ticket.createdAt) + "\n" +
      "**Closed:** " + discordTime(ticket.closedAt) + linkLine
    ));
  if (transcript.publicUrl) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open Transcript").setStyle(ButtonStyle.Link).setURL(transcript.publicUrl)
    ));
  }
  await channel.send({ ...componentPayload(container, { allowedUserIds: [] }), files: [file] }).catch((error) => console.error("Transcript log failed:", error.message));
}

async function sendTranscriptDm(client, ticket, transcript) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;
  const file = new AttachmentBuilder(transcript.filePath, { name: "ticket-transcript-" + transcript.id + ".html" });
  const container = new ContainerBuilder()
    .setAccentColor(0x60a5fa)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## 📄 Your Ticket Transcript\n" +
      "Your **ECRP** support ticket has been closed.\n\n" +
      "**Category:** " + serviceText(ticket.service) + "\n" +
      "**Messages:** " + transcript.count + "\n" +
      "**Created:** " + discordTime(ticket.createdAt) + "\n" +
      "**Closed:** " + discordTime(ticket.closedAt) +
      (transcript.publicUrl ? "\n**Hosted:** " + transcript.publicUrl : "")
    ));
  if (transcript.publicUrl) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open Transcript").setStyle(ButtonStyle.Link).setURL(transcript.publicUrl)
    ));
  }
  await user.send({ ...componentPayload(container, { allowedUserIds: [] }), files: [file] }).catch((error) => console.error("Ticket transcript DM failed:", error.message));
}

async function sendReviewRequest(client, ticket) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) await user.send(componentPayload(buildReviewContainer(ticket), { allowedUserIds: [] })).catch((error) => console.error("Ticket review DM failed:", error.message));
}

async function saveReview(review) {
  return mutateStore((store) => {
    const key = review.ticketId + ":" + review.userId;
    if (store.reviews[key]) return { duplicate: true, review: store.reviews[key] };
    store.reviews[key] = { ...review, submittedAt: nowIso() };
    return { duplicate: false, review: store.reviews[key] };
  });
}

async function logReview(client, review) {
  const channelId = await ratingLogChannelId(review.guildId);
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const stars = "⭐".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const container = new ContainerBuilder().setAccentColor(review.rating >= 4 ? 0x22c55e : 0xfacc15)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      "## ⭐ Ticket Review\n**Rating:** " + stars + " (" + review.rating + "/5)\n**User:** <@" + review.userId + ">\n**Ticket ID:** " + review.ticketId
    ));
  await channel.send(componentPayload(container, { allowedUserIds: [] })).catch(() => null);
}

async function createTicket(interaction, serviceKey) {
  const existing = await findOpenTicket(interaction.guild, interaction.user.id);
  if (existing) {
    await interaction.reply({ content: "You already have an open ticket: <#" + existing.channelId + ">.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const settings = await guildSettings(interaction.guild.id);
  const staffRoleId = settings.supportRoleId || CONFIG.STAFF_ROLE_ID;
  const staffRole = staffRoleId ? await interaction.guild.roles.fetch(staffRoleId).catch(() => null) : null;
  const category = CONFIG.TICKET_CATEGORY_ID ? await interaction.guild.channels.fetch(CONFIG.TICKET_CATEGORY_ID).catch(() => null) : null;
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }
  ];
  if (staffRole) overwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] });
  const channel = await interaction.guild.channels.create({
    name: ticketChannelName({ username: interaction.user.username, status: "Open" }, interaction.user.username),
    type: ChannelType.GuildText,
    parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
    topic: "Ticket for " + interaction.user.tag + " • " + serviceText(serviceKey),
    permissionOverwrites: overwrites,
    reason: "Ticket opened by " + interaction.user.tag
  });
  let ticket = {
    guildId: interaction.guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    username: interaction.user.tag,
    service: serviceKey,
    status: "Open",
    claimedBy: null,
    createdAt: nowIso(),
    panelMessageId: null
  };
  if (staffRole) {
    await channel.send({
      content: `🔔 ${staffRole} • New **${SERVICES[serviceKey]?.label || 'Other'}** ticket from <@${interaction.user.id}>.`,
      allowedMentions: { roles: [staffRole.id], users: [interaction.user.id], parse: [] },
    });
  }
  const panel = await channel.send(componentPayload(buildTicketContainer(ticket), { allowedUserIds: [interaction.user.id] }));
  ticket.panelMessageId = panel.id;
  ticket = await saveTicket(ticket);
  await interaction.editReply({ content: "Created your private ticket: <#" + channel.id + ">." });
}

async function recoverTicketFromChannel(interaction) {
  const channel = interaction.channel;
  if (!interaction.guild || !channel?.isTextBased?.()) return null;
  const name = String(channel.name || "").toLowerCase();
  if (!name.includes("ticket-") && !String(interaction.customId || "").startsWith("ticket:")) return null;
  const userOverwrite = [...(channel.permissionOverwrites?.cache?.values?.() || [])].find((overwrite) => overwrite.type === 1 && overwrite.id !== interaction.client.user.id);
  const userId = userOverwrite?.id || interaction.user.id;
  const recovered = await saveTicket({
    guildId: interaction.guild.id,
    channelId: channel.id,
    userId,
    username: interaction.user.tag,
    service: "other",
    status: name.startsWith("🔴") ? "Closed" : "Open",
    claimedBy: null,
    createdAt: channel.createdAt ? channel.createdAt.toISOString() : nowIso(),
    panelMessageId: interaction.message?.id || null,
    recoveredAt: nowIso()
  });
  console.log("Recovered ticket from channel:", channel.id);
  return recovered;
}

async function handleReview(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("ticket:review:")) return false;
  const [, , ratingRaw, guildId, ticketId, userId] = interaction.customId.split(":");
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "Only the ticket user can submit this review.", flags: 64 });
    return true;
  }

  const rating = Number.parseInt(ratingRaw, 10);
  if (!guildId || !ticketId || !userId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: "This review button is invalid or expired.", flags: 64 });
    return true;
  }

  await interaction.deferUpdate();
  const saved = await saveReview({ guildId, ticketId, userId, rating });
  if (!saved.duplicate) await logReview(interaction.client, saved.review);
  const finalRating = saved.review.rating;
  const stars = "⭐".repeat(finalRating) + "☆".repeat(5 - finalRating);
  const result = componentPayload(
    new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        "## ✅ Review Submitted\n" +
        (saved.duplicate ? "Your review was already recorded.\n\n" : "Thanks for the feedback!\n\n") +
        "**Rating:** " + stars + " (" + finalRating + "/5)"
      )),
    { allowedUserIds: [] }
  );
  delete result.flags;
  await interaction.editReply(result);
  return true;
}

async function initialize(client) {
  const store = await readStore();
  const recovered = [];
  const stale = [];

  for (const ticket of Object.values(store.tickets)) {
    try {
      const guild = client.guilds.cache.get(ticket.guildId) || await client.guilds.fetch(ticket.guildId).catch(() => null);
      const channel = guild ? await guild.channels.fetch(ticket.channelId).catch(() => null) : null;
      if (!guild || !channel?.isTextBased()) {
        stale.push(ticket.channelId);
        continue;
      }

      if (ticket.status === "Closed") {
        stale.push(ticket.channelId);
        await channel.delete("Finishing ticket closure after bot restart").catch(() => null);
        continue;
      }

      let panel = ticket.panelMessageId
        ? await channel.messages.fetch(ticket.panelMessageId).catch(() => null)
        : null;
      const payload = componentPayload(buildTicketContainer(ticket), {
        allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean),
      });
      if (panel) {
        await panel.edit(payload);
      } else {
        panel = await channel.send(payload);
        ticket.panelMessageId = panel.id;
        ticket.recoveredAt = nowIso();
      }
      await syncTicketChannelName(guild, ticket);
      recovered.push(ticket);
    } catch (error) {
      console.error("Ticket recovery failed for", ticket.channelId, error.message);
    }
  }

  await mutateStore((latest) => {
    for (const channelId of stale) delete latest.tickets[channelId];
    for (const ticket of recovered) {
      latest.tickets[ticket.channelId] = { ...latest.tickets[ticket.channelId], ...ticket, updatedAt: nowIso() };
    }
  });

  console.log(`Ticket recovery complete: ${recovered.length} restored, ${stale.length} stale removed.`);
  return { recovered: recovered.length, stale: stale.length };
}

async function handleInteraction(interaction) {
  if (await handleReview(interaction)) return true;
  if (!interaction.guild) return false;
  if (interaction.isStringSelectMenu() && interaction.customId === "ticket:select") {
    await createTicket(interaction, interaction.values?.[0] || "other");
    return true;
  }
  if (!interaction.isButton() || !interaction.customId.startsWith("ticket:")) return false;
  let ticket = await getTicket(interaction.channelId);
  if (!ticket) ticket = await recoverTicketFromChannel(interaction);
  if (!ticket) {
    await interaction.reply({ content: "This ticket is not registered anymore.", flags: 64 });
    return true;
  }
  const action = interaction.customId;
  if (action === "ticket:close-cancel") {
    await interaction.update(componentPayload(buildTicketContainer(ticket), { allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean) }));
    return true;
  }
  if (action === "ticket:close-confirm") {
    if (!await isTicketStaff(interaction.member) && interaction.user.id !== ticket.userId) {
      await interaction.reply({ content: "Only the ticket user or staff can close this ticket.", flags: 64 });
      return true;
    }
    await interaction.update(componentPayload(new ContainerBuilder().setAccentColor(0xef4444).addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🔒 Closing Ticket\nSaving transcript and closing this ticket."))));
    const channel = interaction.channel;
    let closedTicket = { ...ticket, status: "Closed", closedBy: interaction.user.id, closedAt: nowIso() };
    try {
      const transcript = await generateTranscript(channel, closedTicket);
      closedTicket = await saveTicket(closedTicket);
      await sendTranscriptLog(interaction.guild, closedTicket, transcript);
      await sendTranscriptDm(interaction.client, closedTicket, transcript);
      await sendReviewRequest(interaction.client, closedTicket);
    } catch (error) {
      console.error("Ticket close failed:", error);
      await saveTicket(closedTicket).catch(() => null);
    } finally {
      await removeTicket(channel.id).catch(() => null);
      setTimeout(() => channel.delete("Ticket closed").catch((error) => console.error("Ticket channel delete failed:", error.message)), 5000);
    }
    return true;
  }
  if (action === "ticket:close") {
    await interaction.reply(componentPayload(buildCloseConfirmContainer(ticket), { allowedUserIds: [ticket.userId, ticket.claimedBy].filter(Boolean) }));
    return true;
  }
  if (!await isTicketStaff(interaction.member)) {
    await interaction.reply({ content: "Only staff can use this ticket control.", flags: 64 });
    return true;
  }
  if (action === "ticket:claim") {
    if (claimLocks.has(interaction.channelId)) {
      await interaction.reply({ content: "Someone is already claiming this ticket. Try again in a moment.", flags: 64 });
      return true;
    }
    claimLocks.add(interaction.channelId);
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const current = await getTicket(interaction.channelId) || ticket;
      if (current.claimedBy) {
        await interaction.editReply({ content: "This ticket is already claimed by <@" + current.claimedBy + ">." });
        return true;
      }
      const next = await saveTicket({ ...current, status: "Claimed", claimedBy: interaction.user.id });
      await editTicketPanel(interaction.guild, next);
      await interaction.editReply({ content: "✅ You claimed this ticket." });
      void syncTicketChannelName(interaction.guild, next);
      return true;
    } finally {
      claimLocks.delete(interaction.channelId);
    }
  }
  if (action === "ticket:unclaim") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const current = await getTicket(interaction.channelId) || ticket;
    if (!current.claimedBy) {
      await interaction.editReply({ content: "This ticket is not claimed." });
      return true;
    }
    if (current.claimedBy !== interaction.user.id) {
      await interaction.editReply({ content: "Only <@" + current.claimedBy + "> can unclaim this ticket." });
      return true;
    }
    const next = await saveTicket({ ...current, status: "Open", claimedBy: null });
    await editTicketPanel(interaction.guild, next);
    await interaction.editReply({ content: "🔓 Ticket unclaimed." });
    void syncTicketChannelName(interaction.guild, next);
    return true;
  }
  if (action.startsWith("ticket:status:")) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const status = action.slice("ticket:status:".length);
    if (!STATUS_META[status]) {
      await interaction.editReply({ content: "Unknown ticket status." });
      return true;
    }
    const next = await saveTicket({ ...ticket, status });
    await editTicketPanel(interaction.guild, next);
    await interaction.editReply({ content: "📌 Updated this ticket to **" + status + "**." });
    void syncTicketChannelName(interaction.guild, next);
    return true;
  }
  return false;
}

module.exports = { CONFIG, SERVICES, sendTicketPanel, handleInteraction, initialize, isStaff, setGuildChannel, flushStore };
