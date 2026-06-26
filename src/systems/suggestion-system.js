const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');

const STORE_PATH = path.join(__dirname, '..', 'data', 'suggestions.json');
let mutation = Promise.resolve();

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const store = raw.trim() ? JSON.parse(raw) : { suggestions: {} };
    if (!store.suggestions || typeof store.suggestions !== 'object') store.suggestions = {};
    return store;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Suggestion store read failed:', error.message);
    return { suggestions: {} };
  }
}

function mutateStore(mutator) {
  const operation = mutation.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const temporary = STORE_PATH + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(store, null, 2) + '\n', 'utf8');
    await fs.rename(temporary, STORE_PATH);
    return result;
  });
  mutation = operation.catch(() => null);
  return operation;
}

function suggestionId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function totals(suggestion) {
  const votes = Object.values(suggestion.votes || {});
  return {
    up: votes.filter((vote) => vote === 'up').length,
    down: votes.filter((vote) => vote === 'down').length,
  };
}

function payload(suggestion) {
  const count = totals(suggestion);
  const created = Math.floor(new Date(suggestion.createdAt).getTime() / 1000);
  const quotedSuggestion = suggestion.text
    .split(/\r?\n/)
    .map((line) => `> ${line || ' '}`)
    .join('\n');
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# 💡 Community Suggestion\n` +
      `-# Submitted by <@${suggestion.userId}> • <t:${created}:R>`
    ))
    .addSeparatorComponents({ divider: true, spacing: 1 })
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## 📝 Suggestion\n${quotedSuggestion}`
    ))
    .addSeparatorComponents({ divider: true, spacing: 1 })
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Cast your vote below**`
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`suggest:up:${suggestion.id}`)
        .setLabel(`Upvote • ${count.up}`)
        .setEmoji('👍')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`suggest:down:${suggestion.id}`)
        .setLabel(`Downvote • ${count.down}`)
        .setEmoji('👎')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`suggest:clear:${suggestion.id}`)
        .setLabel('Remove Vote')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary)
    ))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# Suggestion ID: ${suggestion.id} • One vote per member`
    ));
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

async function create(interaction) {
  const text = interaction.options.getString('suggestion', true).trim();
  if (text.length < 3) throw new Error('Your suggestion is too short.');
  if (!interaction.channel?.isTextBased()) throw new Error('Suggestions must be used in a text channel.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const suggestion = {
    id: suggestionId(),
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: null,
    userId: interaction.user.id,
    text,
    votes: {},
    createdAt: new Date().toISOString(),
  };
  const message = await interaction.channel.send(payload(suggestion));
  suggestion.messageId = message.id;
  await mutateStore((store) => {
    store.suggestions[suggestion.id] = suggestion;
  });
  await interaction.editReply(`Suggestion posted: ${message.url}`);
}

async function handleInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('suggest:')) return false;
  const [, action, id] = interaction.customId.split(':');
  if (!['up', 'down', 'clear'].includes(action) || !id) return false;

  await interaction.deferUpdate();
  const suggestion = await mutateStore((store) => {
    const current = store.suggestions[id];
    if (!current) return null;
    current.votes ||= {};
    if (action === 'clear') delete current.votes[interaction.user.id];
    else current.votes[interaction.user.id] = action;
    current.updatedAt = new Date().toISOString();
    return { ...current, votes: { ...current.votes } };
  });
  if (!suggestion) {
    await interaction.followUp({ content: 'This suggestion is no longer active.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const updated = payload(suggestion);
  delete updated.flags;
  await interaction.editReply(updated);
  return true;
}

module.exports = { create, handleInteraction };
