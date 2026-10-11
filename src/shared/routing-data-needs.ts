import { smartBaselineGeoTags } from './region-routing';
import type { UserConfig } from './types';

/** Routing data is internal. No application-service lists or user-managed resources. */
export function routingDataNeeds(config: UserConfig): { tags: Set<string> } {
  const tags = smartBaselineGeoTags(config);
  if ((config.proxyMode || 'smart').toLowerCase() !== 'direct' && config.bypassLAN !== false)
    tags.add('geosite-private');
  return { tags };
}
