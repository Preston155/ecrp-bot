const crypto = require('node:crypto');

function secureIndex(max) {
  return crypto.randomInt(0, max);
}

function pickWeighted(entries, count, excludedUserIds = new Set(), allowDuplicates = false) {
  const pool = entries
    .filter((entry) => !excludedUserIds.has(entry.user_id))
    .map((entry) => ({ ...entry, weight: Math.max(1, entry.weight) }));
  const winners = [];

  while (pool.length && winners.length < count) {
    const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let target = secureIndex(totalWeight);
    let selectedIndex = 0;

    for (let index = 0; index < pool.length; index += 1) {
      target -= pool[index].weight;
      if (target < 0) {
        selectedIndex = index;
        break;
      }
    }

    winners.push(pool[selectedIndex]);
    if (!allowDuplicates) pool.splice(selectedIndex, 1);
  }

  return winners;
}

module.exports = { pickWeighted };
