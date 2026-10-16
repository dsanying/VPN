import { NodeIdentity } from './NodeIdentity';
import { clientHost } from '@/config/client-host';
import { MinusOutlined, BorderOutlined, CloseOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, ResponsiveActions, AtomicValue, StatusTag } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import { useSpeedTestStore } from '@/store/useSpeedTestStore';
import { api } from '@/ipc';
import './desktop.css';
export function DesktopTitlebar() {
  const { t } = useTranslation();
  const brand = t('common.brand');
  useEffect(() => {
    document.title = brand;
  }, [brand]);
  const platform = window.electron?.platform;
  if (clientHost().platform !== 'desktop') return null;
  return (
    <div className="ds-desktop-titlebar" data-platform={platform}>
      <span>{t('common.brand')}</span>
      {platform === 'linux' ? (
        <ResponsiveActions>
          <IconButton
            icon={<MinusOutlined aria-hidden />}
            label={t('common.vocab.minimize')}
            onClick={() => void api.window.minimize()}
          />
          <IconButton
            icon={<BorderOutlined aria-hidden />}
            label={t('common.vocab.maximize')}
            onClick={() => void api.window.maximizeToggle()}
          />
          <IconButton
            icon={<CloseOutlined aria-hidden />}
            label={t('common.actions.close')}
            onClick={() => void api.window.close()}
          />
        </ResponsiveActions>
      ) : null}
    </div>
  );
}
export function DesktopStatus() {
  const running = useAppStore((s) => s.connectionStatus?.proxyCore.running ?? false);
  const config = useAppStore((s) => s.config);
  const ip = useAppStore((s) => s.ipInfo);
  const testing = useSpeedTestStore((s) => s.testing.length > 0);
  const progress = useSpeedTestStore((s) => s.progress);
  const { t } = useTranslation();
  const node = config?.servers.find((n) => n.id === config.selectedServerId);
  const percent = Math.min(100, Math.round((progress.tested / Math.max(progress.total, 1)) * 100));
  return (
    <footer className="ds-desktop-status">
      <StatusTag tone={running ? 'success' : 'neutral'}>
        {t(running ? 'vpn.connected' : 'vpn.disconnected')}
      </StatusTag>
      {node ? <NodeIdentity nodeId={node.id} name={node.name} /> : null}
      {ip ? (
        <AtomicValue text={(running ? ip.proxy : ip.direct)?.ip ?? t('common.emptyValue')} />
      ) : null}
      {testing ? (
        <span className="ds-desktop-status__progress" role="status">
          <span>{t('vpn.testing', progress)}</span>
          <span className="ds-desktop-status__meter" aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>
      ) : null}
    </footer>
  );
}
