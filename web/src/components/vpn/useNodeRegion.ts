import { regionDisplayName } from './nodeDisplayCache';
import { useTranslation } from 'react-i18next';
import { normalizeCountryCode } from '@shared/country';
import { useAppStore } from '@/store/app-store';

/** Read the backend measurement cache; rendering never triggers a region lookup. */
export function useNodeRegion(nodeId: string) {
  const { t, i18n } = useTranslation();
  const exit = useAppStore(state => state.probeDetails[nodeId]?.exit);
  const code = normalizeCountryCode(exit?.countryCode);
  const name = code ? regionDisplayName(i18n.language, code) : undefined;
  return { exit, code, name: name ?? t('common.vocab.unidentified') };
}
