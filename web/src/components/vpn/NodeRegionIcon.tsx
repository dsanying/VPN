import './ApplicationIdentity.css';
import { nodeRegionSymbol } from '@shared/node-identity';
import { GlobalOutlined } from '@ant-design/icons';
import { countryCodeToFlagAsset } from '../../../../src/renderer-domain/components/settings/flag-assets';
import { useNodeRegion } from './useNodeRegion';
import { Tooltip } from 'antd';
import { formatDateTime } from '@/utils/dateTime';

/** Shared flag asset cache and unknown-region fallback for lists and selectors. */
export function NodeRegionIcon({ nodeId }: { nodeId: string }) {
  const { code, name, exit } = useNodeRegion(nodeId);
  const icon = <RegionIcon code={code} name={name} />;
  if (!exit) return icon;
  const metadata = [exit.provider, name, exit.ip, formatDateTime(exit.measuredAt)]
    .filter(Boolean)
    .join(' · ');
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
