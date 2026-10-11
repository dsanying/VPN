import { createHash } from 'crypto';
import type { UserConfig } from '../../shared/types';
import type { UnlockSnapshot } from '../../shared/unlock-detection';
import { measurementDatabase } from './MeasurementDatabase';
export function websiteFingerprint(config: UserConfig, running: boolean): string {
  // Current-system results and proxy/rules results belong to different network contexts.
  const context = running
    ? [
        config.selectedServerId,
        config.proxyMode,
        config.servers,
        config.customRules,
        config.appRules,
        config.dnsConfig,
      ]
    : 'system';
  return createHash('sha256')
    .update(JSON.stringify([running, context]))
    .digest('hex');
}
export class WebsiteMeasurementStore {
  private readonly database;
  constructor(file: string) {
    this.database = measurementDatabase(file);
  }
  read(fingerprint: string): UnlockSnapshot | null {
    const record = this.database.read<{ fingerprint: string; value: UnlockSnapshot }>(
      'website'
    ).current;
    if (record?.fingerprint === fingerprint) return record.value;
    this.clear();
    return null;
  }
  save(fingerprint: string, value: UnlockSnapshot): void {
    if (value.checkedAt) this.database.replace('website', { current: { fingerprint, value } });
  }
  clear(): void {
    this.database.replace('website', {});
  }
}
