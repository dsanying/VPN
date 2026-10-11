import { DEFAULT_SPEED_TEST_URL } from '../../shared/speed-test';
import { EventEmitter } from 'events';
import type { UserConfig } from '../../shared/types';
import { measurementFingerprint } from './NodeMeasurementStore';
import { subscriptionFingerprint } from './SubscriptionMeasurementService';

import type { MeasurementRefreshScope } from '../../shared/measurement-refresh-scope';
export { changedMeasurementScope } from '../../shared/measurement-refresh-scope';
export type {
  MeasurementRefreshScope,
  MeasurementConfigSnapshot,
} from '../../shared/measurement-refresh-scope';
// Separate from CONFIG_CHANGED: measuring saved content must never restart the proxy.
export const measurementRefreshEvents = new EventEmitter();
export function measurementConfigSaved(manager: object, config: UserConfig): void {
  measurementRefreshEvents.emit('saved', manager, config);
}
export function requestMeasurementRefresh(manager: object, scope: MeasurementRefreshScope): void {
  measurementRefreshEvents.emit('refresh', manager, scope);
}
export function measurementConfigSnapshot(config: UserConfig) {
  return {
    target: DEFAULT_SPEED_TEST_URL,
    nodes: new Map(
      config.servers.map((node) => [
        node.id,
        {
          fingerprint: measurementFingerprint(node, DEFAULT_SPEED_TEST_URL),
          group: node.subscriptionId,
        },
      ])
    ),
    subscriptions: new Map(
      (config.subscriptions ?? []).map((sub) => [
        sub.id,
        {
          fingerprint: subscriptionFingerprint(sub),
          updated: sub.lastUpdated,
          source: JSON.stringify([sub.name]),
        },
      ])
    ),
  };
}
