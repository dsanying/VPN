import type { ConnectionsSnapshot, InstalledApplication } from '../../shared/types';
import { connectionApplication, UNKNOWN_APPLICATION } from '../../shared/live-traffic';
import { applicationIdentity, readApplicationIcon } from './InstalledApplications';

/** Observed paths include development bundles and tools outside installation directories.
 * Presentation-only: never register these identities as routing rules. Native work is cached
 * and coalesced per path, with a bounded cache and no separate scanning timer.
 */
export function createConnectionApplicationResolver(
  readIcon = readApplicationIcon,
  platform: NodeJS.Platform = process.platform
) {
  const cache = new Map<string, { at: number; value: Promise<InstalledApplication> }>();
  let lastKey = '';
  let lastAt = 0;
  let lastValue: InstalledApplication[] = [];
  return async (snapshot: ConnectionsSnapshot): Promise<ConnectionsSnapshot> => {
    const identities = new Map<string, string>();
    for (const connection of snapshot.connections) {
      if (!connection.metadata?.processPath) continue;
      const app = connectionApplication(connection);
      if (app.identity !== UNKNOWN_APPLICATION) identities.set(app.identity, app.name);
    }
    const key = JSON.stringify([...identities]);
    if (key === lastKey && Date.now() - lastAt < 300_000)
      return { ...snapshot, applications: lastValue };
    const applications: InstalledApplication[] = [];
    const entries = [...identities];
    for (let start = 0; start < entries.length; start += 8) {
      applications.push(
        ...(await Promise.all(
          entries.slice(start, start + 8).map(([file, name]) => {
            const found = cache.get(file);
            if (found && Date.now() - found.at < 300_000) return found.value;
            const value = (async () => {
              const identity = applicationIdentity(name, file, platform);
              try {
                identity.iconDataUrl = await readIcon(file);
              } catch {
                /* Keep the real process identity. */
              }
              return identity;
            })();
            if (cache.size >= 512) cache.delete(cache.keys().next().value!);
            cache.set(file, { at: Date.now(), value });
            return value;
          })
        ))
      );
    }
    lastAt = Date.now();
    lastKey = key;
    lastValue = applications;
    return { ...snapshot, applications };
  };
}
