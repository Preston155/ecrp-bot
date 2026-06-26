const http = require('node:http');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

function startHealthServer(client) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'Not found' }));
      return;
    }

    const ready = client.isReady();
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: ready,
      status: ready ? 'online' : 'starting',
      user: client.user?.tag || null,
      guilds: client.guilds.cache.size,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }));
  });

  server.listen(env.healthPort, '127.0.0.1', () => {
    logger.info('health_server_ready', {
      url: `http://127.0.0.1:${env.healthPort}/health`,
    });
  });

  server.on('error', (error) => logger.error('health_server_failed', error));
  return server;
}

module.exports = { startHealthServer };
