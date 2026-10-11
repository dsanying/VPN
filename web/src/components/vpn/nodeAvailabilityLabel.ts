import type {TFunction} from 'i18next';
import type {NodeAvailabilityState} from '@shared/node-availability';
export function nodeAvailabilityLabel(state:NodeAvailabilityState,t:TFunction) {
 return {unknown:t('common.vocab.unconfirmed'),available:t('vpn.availability.available'),failed:t('vpn.availability.failed'),stale:t('vpn.availability.stale'),untested:t('vpn.untested')}[state];
}
