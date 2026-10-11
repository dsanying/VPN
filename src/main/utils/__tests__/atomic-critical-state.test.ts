import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeFileAtomic } from '../atomic-write';

test('critical replacement is readable, private, and leaves no temporary files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-critical-state-'));
  const file = path.join(directory, 'trust.json');
  try {
    await writeFileAtomic(file, '{"issuedAt":1}', { mode: 0o600, flush: true });
    await writeFileAtomic(file, '{"issuedAt":2}', { mode: 0o600, flush: true });
    expect(await fs.readFile(file, 'utf8')).toBe('{"issuedAt":2}');
    expect(await fs.readdir(directory)).toEqual(['trust.json']);
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed replacement cannot destroy previously accepted critical state', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-critical-state-'));
  const file = path.join(directory, 'trust.json');
  try {
    await writeFileAtomic(file, 'accepted', { mode: 0o600, flush: true });
    const rejected = jest
      .spyOn(jest.requireActual<typeof fs>('fs/promises'), 'rename')
      .mockRejectedValueOnce(new Error('disk failure'));
    try {
      let replacement: typeof writeFileAtomic;
      jest.isolateModules(() => {
        replacement = jest.requireActual('../atomic-write').writeFileAtomic;
      });
      await expect(replacement!(file, 'replacement', { mode: 0o600, flush: true })).rejects.toThrow(
        'disk failure'
      );
    } finally {
      rejected.mockRestore();
    }
    expect(await fs.readFile(file, 'utf8')).toBe('accepted');
    expect(await fs.readdir(directory)).toEqual(['trust.json']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
