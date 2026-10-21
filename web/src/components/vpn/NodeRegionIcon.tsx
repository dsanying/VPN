import './ApplicationIdentity.css';
import { regionDisplayName } from './nodeDisplayCache';
import { nodeRegionSymbol } from '@shared/node-identity';
import { GlobalOutlined } from '@ant-design/icons';
import { countryCodeToFlagAsset } from '@/domain/components/settings/flag-assets';
import { useNodeRegion } from './useNodeRegion';
import { Tooltip } from 'antd';
import { observationIsFresh } from '@shared/background-refresh';
import { useMeasurementClock } from './useMeasurementClock';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/utils/dateTime';

/** Shared flag asset cache and unknown-region fallback for lists and selectors. */
export function NodeRegionIcon({ nodeId }: { nodeId: string }) {
  const { t, i18n } = useTranslation();
  const time = useMeasurementClock();
  const { code, name, evidence, detail } = useNodeRegion(nodeId);
  if (!evidence) return <RegionIcon code={code} name={name} help={t(detail?.gateway?.reason === 'non-public-address' ? 'vpn.regionPrivateHint' : 'vpn.regionUnknownHint')} />;
  const describe = (source: 'exit' | 'gateway', value: NonNullable<typeof detail>['exit']) => value && [
    t(source === 'exit' ? 'vpn.exitRegion' : 'vpn.gatewayRegion'),
    value.countryCode ? regionDisplayName(i18n.language, value.countryCode) : t('common.vocab.unidentified'),
    value.ip, value.provider, formatDateTime(value.measuredAt),
    !observationIsFresh(value.measuredAt, time) ? t('vpn.regionHistory') : undefined,
  ].filter(Boolean).join(' · ');
  const metadata = [describe('exit', detail?.exit), describe('gateway', detail?.gateway),
    evidence.source === 'gateway' ? t('vpn.gatewayRegionHint') : undefined].filter(Boolean).join('；');
  return <RegionIcon code={code} name={name} help={metadata} />;
}

/** The same measured-region presentation for node identities and region filters. */
export function RegionIcon({ code, name, help }: { code?: string; name: string; help?: string }) {
  const flag = countryCodeToFlagAsset(code ?? null);
  const icon = (
    <span
      className="ds-application-icon"
      role="img"
      aria-label={name}
      tabIndex={help ? 0 : undefined}
    >
      {flag ? (
        <img src={flag.src} alt="" />
      ) : code ? (
        <span aria-hidden>{nodeRegionSymbol(code)}</span>
      ) : (
        <GlobalOutlined aria-hidden />
      )}
    </span>
  );
  return help ? (
    <Tooltip
      title={help}
      trigger={['hover', 'focus', 'click']}
      destroyOnHidden
      classNames={{ root: 'client-help-popup' }}
    >
      {icon}
    </Tooltip>
  ) : (
    icon
  );
}
