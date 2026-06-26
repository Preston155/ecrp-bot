const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

function activeLevel() {
  return levels[process.env.LOG_LEVEL?.toLowerCase()] || levels.info;
}

function serializeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause,
  };
}

function write(level, event, errorOrMeta, extraMeta) {
  if (levels[level] < activeLevel()) return;

  const error = errorOrMeta instanceof Error ? serializeError(errorOrMeta) : undefined;
  const meta = error
    ? extraMeta
    : errorOrMeta && typeof errorOrMeta === 'object'
      ? errorOrMeta
      : undefined;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(meta || {}),
    ...(error ? { error } : {}),
  };

  const output = JSON.stringify(payload);
  if (level === 'error' || level === 'fatal') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

const logger = Object.freeze({
  debug: (event, meta) => write('debug', event, meta),
  info: (event, meta) => write('info', event, meta),
  warn: (event, meta) => write('warn', event, meta),
  error: (event, error, meta) => write('error', event, error, meta),
  fatal: (event, error, meta) => write('fatal', event, error, meta),
});

module.exports = { logger };
