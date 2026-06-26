const manager = require('./GiveawayManager');

module.exports = {
  start(client) {
    return manager.initialize(client);
  },
};
