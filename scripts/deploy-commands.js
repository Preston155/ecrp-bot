require('dotenv').config();

const { REST, Routes } = require('discord.js');
const giveaway = require('../src/commands/giveaways/giveaway');
const suggest = require('../src/commands/utility/suggest');
const verify = require('../src/commands/utility/verify');

function clientIdFromToken(token) {
  const encoded = token.split('.')[0];
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN is missing.');
  const clientId = process.env.CLIENT_ID || clientIdFromToken(token);
  if (!/^\d{17,20}$/.test(clientId)) throw new Error('Unable to determine CLIENT_ID.');

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [giveaway.data.toJSON(), suggest.data.toJSON(), verify.data.toJSON()];
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Deployed ${commands.length} global command group to ${clientId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
