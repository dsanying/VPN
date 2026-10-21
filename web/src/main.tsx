import { installClientHost } from '@/config/client-host';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import '@/i18n';
import './design/tokens.css';
import './global.css';
import { App } from '@/App';
import { ClientStartup } from '@/components/vpn/ClientStartup';
import { bootstrapPersistedTheme } from '@/store/useThemeStore';
import { installOverflowScroll } from '@/components/client';

// React 挂载前应用持久化主题偏好，避免首帧闪白/闪黑。
bootstrapPersistedTheme();

// 单行内容的横向滚动槽位只在真放不下时才可滚（含弹层，故挂在 body 上）。
installOverflowScroll(document.body);

const reactRoot = createRoot(document.getElementById('root')!);

async function mountClient() {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    reactRoot.render(<ClientStartup />);
    if (Capacitor.getPlatform() !== 'android') throw new Error('Unsupported native platform');
    const { createMobileRuntime } = await import('./mobile/runtime');
    const { ipcClient } = await import('./ipc/ipc-client');
    const runtime = await createMobileRuntime();
    ipcClient.installTransport(runtime.transport);
    installClientHost({
      platform: 'android',
      desktopHelper: false,
      loginAutostart: runtime.capabilities.desktopLoginAutostart,
      tray: false,
      failover: false,
      bundledCore: !runtime.capabilities.externalCoreReplacement,
    });
  }
  reactRoot.render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>
  );
}
void mountClient().catch(() => {
  reactRoot.render(<ClientStartup failed />);
});
