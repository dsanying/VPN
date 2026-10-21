import { NodeAuthenticationHost } from '@/components/vpn/NodeAuthenticationHost';
import { useEffect } from 'react';
import { useRoutes } from 'react-router';
import { ConfigProvider, App as AntdApp } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import type { Locale } from 'antd/es/locale';
import { useTranslation } from 'react-i18next';
import { routes } from '@/routes';
import { buildThemeConfig } from '@/config/theme';
import { useThemeStore } from '@/store/useThemeStore';
import { useVpnRuntime } from '@/hooks/useVpnRuntime';
import { useAppStore } from '@/store/app-store';
import { setStaticInstances } from '@/utils/antdStatic';
import { modalDefaults } from '@/components/client';
import { DesktopTitlebar, DesktopStatus } from '@/components/vpn/DesktopFrame';
import { RuntimeBoundary } from '@/components/vpn/RuntimeBoundary';
import { GlobalUpdateNotice } from '@/components/vpn/GlobalUpdates';

// Product labels and field help own instructions, including framework defaults.
function clientLocale(module: Locale | { default: Locale }): Locale {
  const source = 'default' in module ? module.default : module;
  const text = JSON.stringify(source, (key, value: unknown) => {
    if (!key.toLowerCase().includes('placeholder')) return value;
    if (typeof value === 'string') return '';
    if (Array.isArray(value)) return value.map(() => '');
    return value;
  });
  return JSON.parse(text) as Locale;
}
const locales: Record<string, Locale> = {
  'zh-CN': clientLocale(zhCN),
  'en-US': clientLocale(enUS),
};
function FeedbackBridge() {
  const { notification } = AntdApp.useApp();
  useEffect(() => setStaticInstances({ notification }), [notification]);
  return null;
}
export function App() {
  useVpnRuntime();
  const { i18n } = useTranslation();
  const mode = useThemeStore(state => state.mode);
  const ready = useAppStore(state => state.config !== null);
  const content = useRoutes(routes);
  return <ConfigProvider
    locale={locales[i18n.language] ?? locales['zh-CN']}
    theme={buildThemeConfig(mode)}
    modal={modalDefaults}
    popupMatchSelectWidth={false}
    form={{ tooltip: { icon: <QuestionCircleOutlined aria-hidden />,
      classNames: { root: 'ds-tooltip', container: 'ds-tooltip__container' },
      align: { overflow: { adjustX: true, adjustY: true, shiftX: true } } } }}
    cascader={{ classNames: { content: 'ds-select-content' }, styles: { root: { minWidth: 0, maxWidth: '100%' } } }}
    select={{ classNames: { content: 'ds-select-content', itemContent: 'ds-select-tag-content', popup: { listItem: 'ds-select-option' } } }}
  >
    <AntdApp className="ds-desktop-shell" notification={{ placement: 'topRight', duration: 3, showProgress: true, stack: { threshold: 2 } }}>
      <FeedbackBridge />
      <GlobalUpdateNotice />
      {ready ? <NodeAuthenticationHost /> : null}
      <DesktopTitlebar />
      <div className="ds-desktop-body"><RuntimeBoundary>{content}</RuntimeBoundary></div>
      {ready ? <DesktopStatus /> : null}
    </AntdApp>
  </ConfigProvider>;
}
