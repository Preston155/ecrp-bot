require('dotenv').config();

const { createClient } = require('./core/create-client');
const { loadEvents } = require('./core/load-events');
const { startHealthServer } = require('./core/health-server');
const { env } = require('./config/env');
const { logger } = require('./utils/logger');
const statusPanels = require('./systems/status/StatusPanelManager');
const counting = require('./systems/counting-system');
const tickets = require('./systems/ticket-system');
const verification = require('./systems/verification-system');

async function bootstrap() {
  const client = createClient();

  await loadEvents(client);
  const healthServer = startHealthServer(client);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('shutdown_started', { signal });
    healthServer.close();

    try {
      await Promise.race([
        statusPanels.markOffline(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Offline status update timed out.')), 10_000)),
      ]);
    } catch (error) {
      logger.warn('status_panels_offline_failed', { message: error.message });
    }

    await Promise.all([
      counting.flushStore().catch((error) => logger.warn('counting_flush_failed', { message: error.message })),
      tickets.flushStore().catch((error) => logger.warn('ticket_flush_failed', { message: error.message })),
      verification.flushStore().catch((error) => logger.warn('verification_flush_failed', { message: error.message })),
    ]);
    client.destroy();
    logger.info('shutdown_complete');
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (error) => {
    logger.error('unhandled_rejection', error);
  });

  process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', error);
  });

  await client.login(env.discordToken);
}

bootstrap().catch((error) => {
  logger.fatal('startup_failed', error);
  process.exit(1);
});
