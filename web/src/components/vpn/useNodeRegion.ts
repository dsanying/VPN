import { regionDisplayName } from './nodeDisplayCache';
import { useTranslation } from 'react-i18next';
import { nodeRegionCode, nodeRegionEvidence } from '@shared/node-identity';
import { useAppStore } from '@/store/app-store';

/** Read the backend measurement cache; rendering never triggers a region lookup. */
export function useNodeRegion(nodeId: string) {
  const { t, i18n } = useTranslation();
  const detail = useAppStore(state => state.probeDetails[nodeId]);
  const evidence = nodeRegionEvidence(detail);
  const code = nodeRegionCode(detail);
  const name = code ? regionDisplayName(i18n.language, code) : undefined;
  return { detail, evidence, code, name: name ?? t('common.vocab.unidentified') };
}
