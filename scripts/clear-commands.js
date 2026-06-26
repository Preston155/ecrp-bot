require('dotenv').config();

const { REST, Routes } = require('discord.js');

function clientIdFromToken(token) {
  return Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN is missing.');
  const clientId = process.env.CLIENT_ID || clientIdFromToken(token);
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log(`Cleared global commands for ${clientId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
