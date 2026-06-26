const fs = require('node:fs/promises');
const path = require('node:path');
const { logger } = require('../utils/logger');

async function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');
  const entries = await fs.readdir(eventsPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const event = require(path.join(eventsPath, file));

    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn('event_skipped', { file, reason: 'Invalid event module' });
      continue;
    }

    const handler = (...args) => Promise.resolve(event.execute(...args, client)).catch((error) => {
      logger.error('event_failed', error, { event: event.name, file });
    });

    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }

    logger.debug('event_loaded', { event: event.name, file });
  }

  logger.info('events_ready', { count: files.length });
}

module.exports = { loadEvents };
