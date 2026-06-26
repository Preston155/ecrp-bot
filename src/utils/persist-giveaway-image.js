const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_DIR = '/root/bots/bot6/httpdocs/giveaway-images';
const PUBLIC_BASE_URL = 'https://api.prestonhq.com/giveaway-images';
const MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function extensionFrom(sourceUrl, contentType, fallbackName = '') {
  const byType = EXTENSIONS[String(contentType || '').split(';')[0].trim().toLowerCase()];
  if (byType) return byType;
  const raw = fallbackName || (() => {
    try { return new URL(sourceUrl).pathname; } catch { return ''; }
  })();
  const ext = path.extname(raw).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : '.png';
}

async function persistGiveawayImage(sourceUrl, options = {}) {
  if (!sourceUrl) return null;
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('The image URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('The image URL must be HTTP or HTTPS.');
  }

  const res = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'PrestonHQ-GiveawayBot/1.0' },
  });
  if (!res.ok) throw new Error(`Could not download giveaway image (${res.status}).`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error('Giveaway image must be an image file.');
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error('Giveaway image is too large. Maximum size is 10 MB.');
  }

  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const ext = extensionFrom(sourceUrl, contentType, options.sourceName);
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const filePath = path.join(PUBLIC_DIR, name);
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  return `${PUBLIC_BASE_URL}/${name}`;
}

module.exports = { persistGiveawayImage };
