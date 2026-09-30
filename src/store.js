import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Persists engine state to a JSON file so a restart doesn't forget who sits where. */
export class JsonStore {
  constructor(path) {
    this.path = path;
    this.pending = null;
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async save(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, this.path);
  }

  /** Coalesce bursts of changes into one write. */
  scheduleSave(getState, delayMs = 1000) {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.save(getState()).catch((err) => console.error('Failed to persist state:', err));
    }, delayMs);
  }

  async flush(getState) {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    await this.save(getState());
  }
}
