import { Button, ConfigProvider, Result, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildThemeConfig } from '@/config/theme';
import { useThemeStore } from '@/stores/useThemeStore';
import { designTokens } from '@/design/tokens';

/** Startup has no business reads: the native owner initializes before pages mount. */
export function ClientStartup({ failed = false }: { failed?: boolean }) {
  const { t } = useTranslation();
  const mode = useThemeStore(state => state.mode);
  return <ConfigProvider theme={buildThemeConfig(mode)}>
    <main style={{ height: '100dvh', display: 'grid', placeItems: 'center', padding: designTokens.space.xl, background: 'var(--ds-color-canvas)', color: 'var(--ds-color-text)' }}>
      {failed ? <Result status="error" title={t('vpn.startupFailed')} extra={<Button type="primary" onClick={() => window.location.reload()}>{t('common.actions.retry')}</Button>} /> :
        <div role="status" aria-busy="true" style={{ display: 'grid', justifyItems: 'center', gap: designTokens.space.lg }}><Spin /><span>{t('vpn.startupLoading')}</span></div>}
    </main>
  </ConfigProvider>;
}
