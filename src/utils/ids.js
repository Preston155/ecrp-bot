const crypto = require('node:crypto');

function giveawayId() {
  return `GW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

module.exports = { giveawayId };
