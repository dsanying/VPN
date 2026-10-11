import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ConfigDocumentStore } from '../../shared/config-repository';
import { getUserDataPath } from '../utils/paths';
import { writeFileAtomic } from '../utils/atomic-write';

/** Small host-owned documents share one private, durable file policy. */
export function privateDocumentStore(): ConfigDocumentStore {
  const directory = getUserDataPath();
  const file = (name: string) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid private document name');
    return path.join(directory, `${name}.json`);
  };
  return {
    read: async (name) => {
      try {
        return await fs.readFile(file(name), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    write: (name, content) => writeFileAtomic(file(name), content, { mode: 0o600, flush: true }),
  };
}
