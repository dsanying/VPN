import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

/** Only retry macOS's transient disk-image resource contention. Other errors remain fatal. */
export async function createDmg(args, { run = spawnSync, wait = setTimeout } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run('hdiutil', ['create', ...args], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.error) throw result.error;
    if (result.status === 0) return output;
    if (attempt === 3 || !/hdiutil: create failed - Resource busy/i.test(output))
      throw new Error(`DMG creation failed (${result.status}): ${output}`);
    process.stderr.write(`DMG resource busy; retry ${attempt}/2 in ${attempt * 2}s\n`);
    await wait(attempt * 2000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(await createDmg(process.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
