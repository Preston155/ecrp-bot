const fs = require('node:fs/promises');
const path = require('node:path');

class JsonStore {
  constructor(filename, defaultValue = {}) {
    this.filePath = path.join(__dirname, '..', 'data', filename);
    this.defaultValue = defaultValue;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const contents = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(contents);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.write(this.defaultValue);
        return structuredClone(this.defaultValue);
      }
      throw error;
    }
  }

  write(value) {
    this.writeQueue = this.writeQueue.then(async () => {
      const directory = path.dirname(this.filePath);
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    });

    return this.writeQueue;
  }

  async update(mutator) {
    const current = await this.read();
    const next = await mutator(current);
    await this.write(next ?? current);
    return next ?? current;
  }
}

module.exports = { JsonStore };
