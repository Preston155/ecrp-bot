const UNITS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
};

function humanize(milliseconds) {
  if (!milliseconds) return 'Permanent';
  const units = [
    ['month', UNITS.mo],
    ['week', UNITS.w],
    ['day', UNITS.d],
    ['hour', UNITS.h],
    ['minute', UNITS.m],
    ['second', UNITS.s],
  ];
  const parts = [];
  let remaining = milliseconds;
  for (const [name, size] of units) {
    const count = Math.floor(remaining / size);
    if (count) {
      parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
      remaining %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0 seconds';
}

function parse(input, allowPermanent = false) {
  const value = String(input || '').trim().toLowerCase();
  if (allowPermanent && ['permanent', 'perm'].includes(value)) {
    return { milliseconds: null, human: 'Permanent', expiresAt: null };
  }
  const matches = [...value.matchAll(/(\d+)\s*(mo|[smhdw])/g)];
  if (!matches.length || matches.map((match) => match[0]).join('').replace(/\s/g, '') !== value.replace(/\s/g, '')) {
    throw new Error('Invalid duration. Try `30s`, `10m`, `2h`, `7d`, or `2w`.');
  }
  const milliseconds = matches.reduce((sum, match) => sum + Number(match[1]) * UNITS[match[2]], 0);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1000) throw new Error('Duration is invalid.');
  return { milliseconds, human: humanize(milliseconds), expiresAt: Date.now() + milliseconds };
}

module.exports = { parse, humanize };
