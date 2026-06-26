# Bot4

A clean Discord.js v14 foundation built for long-running VPS use.

## Included

- Minimal Discord gateway intents
- Automatic event loading
- Environment validation
- Structured console logging
- Persistent JSON storage with atomic writes
- Local health endpoint
- Graceful shutdown
- PM2 configuration

No commands or product features are registered yet.

## Start

1. Copy `.env.example` to `.env`.
2. Add the Discord bot token.
3. Run `npm start` or `npm run pm2:start`.

Health check: `http://127.0.0.1:3044/health`
