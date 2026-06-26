const UNITS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDuration(input) {
  const value = String(input || '').trim().toLowerCase();
  const matches = [...value.matchAll(/(\d+)\s*([smhdw])/g)];
  if (!matches.length || matches.map((match) => match[0]).join('').replace(/\s/g, '') !== value.replace(/\s/g, '')) {
    return null;
  }
  const duration = matches.reduce((total, match) => total + Number(match[1]) * UNITS[match[2]], 0);
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null;
}

function shortDuration(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds >= 604800) return `${Math.ceil(seconds / 604800)}w`;
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${seconds}s`;
}

function discordTimestamp(milliseconds, style = 'R') {
  return `<t:${Math.floor(milliseconds / 1000)}:${style}>`;
}

module.exports = { parseDuration, shortDuration, discordTimestamp };
