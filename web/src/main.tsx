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

// 渲染端错误诊断上报：Electron console-message 的 MessageDetails 无 stack 字段，压缩产物下
// 「Uncaught Error: Minified React error #N」只有一行 message，无法定位出错组件。React 19 根
// 选项能拿到 componentStack；非 React 错误走 window 兜底带 error.stack。主进程 GAP-1c 转发链
// （console-message → app.log，限频 + 截断）不变，这里只负责把堆栈补进 message。
const reportError = (label: string, error: unknown, componentStack?: string): void => {
  const parts = [
    `[${label}] ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
    componentStack,
  ].filter(Boolean) as string[];
  console.error(parts.join('\n').slice(0, 8000));
};

// React 渲染期错误（含 #185 最大更新深度）：根选项替代默认 rethrow，Chromium 不再重复输出单行。
const reactRoot = createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, errorInfo) =>
    reportError('react-uncaught', error, errorInfo.componentStack),
  onCaughtError: (error, errorInfo) => reportError('react-caught', error, errorInfo.componentStack),
  onRecoverableError: (error, errorInfo) =>
    reportError('react-recoverable', error, errorInfo.componentStack),
});

// 非 React 的未捕获错误 / Promise 拒因：preventDefault 抑制 Chromium 默认单行输出（避免双条）。
window.addEventListener('error', (event) => {
  reportError('uncaught', event.error ?? event.message);
  event.preventDefault();
});
window.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled-rejection', event.reason);
  event.preventDefault();
});

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
