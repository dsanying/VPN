import { useEffect, useState } from 'react';
import { MainLayout } from './components/layout/main-layout';
import { useAppStore } from './store/app-store';
import { useNativeEventListeners } from './hooks/use-native-events';
import { HomePage } from './pages/home-page';
import { ServerPage } from './pages/server-page';
import { RulesPage } from './pages/rules-page';
import { SettingsPage } from './pages/settings-page';
import { Toaster } from './components/ui/sonner';
import { ErrorBoundary } from './components/error-boundary';
import { ipcClient } from './ipc/ipc-client';
import { toast } from 'sonner';
import { PrivacyOverlay } from './components/layout/privacy-overlay';

function App() {
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const loadConfig = useAppStore((state) => state.loadConfig);
  const refreshConnectionStatus = useAppStore((state) => state.refreshConnectionStatus);
  const setPrivacyMode = useAppStore((state) => state.setPrivacyMode);

  // Settings sub-navigation state
  const [settingsSection, setSettingsSection] = useState('general');

  // When leaving settings, reset to general
  const handleViewChange = (view: string) => {
    setCurrentView(view);
    if (view !== 'settings') {
      setSettingsSection('general');
    }
  };

  // Listen to native events
  useNativeEventListeners();

  // Add platform class to <html> so CSS can be platform-aware
  // e.g. "platform-darwin" on macOS, "platform-win32" on Windows
  useEffect(() => {
    const platform = window.electron?.platform ?? 'unknown';
    document.documentElement.classList.add(`platform-${platform}`);
  }, []);

  // Load initial data
  useEffect(() => {
    loadConfig();
    refreshConnectionStatus();

    // Poll connection status every 2 seconds
    const statusInterval = setInterval(() => {
      refreshConnectionStatus();
    }, 2000);

    return () => clearInterval(statusInterval);
  }, [loadConfig, refreshConnectionStatus]);

  // Listen to navigate events from main process (tray menu)
  useEffect(() => {
    const routeMap: Record<string, string> = {
      '/settings': 'settings',
      '/home': 'home',
      '/server': 'server',
      '/rules': 'rules',
    };

    const unsubscribe = ipcClient.on<string>('navigate', (route) => {
      const view = routeMap[route];
      if (view) {
        handleViewChange(view);
      }
    });

    return () => unsubscribe();
  }, [setCurrentView]);

  // Listen to speed test results
  useEffect(() => {
    const unsubscribe = ipcClient.on<
      Array<{ name: string; protocol: string; latency: number | null }>
    >('speedTestResult', (results) => {
      const message = results
        .map((r) =>
          r.latency !== null
            ? `${r.name}（${r.protocol}）: ${r.latency}ms`
            : `${r.name}（${r.protocol}）: 超时`
        )
        .join('\n');

      toast.info('测速结果', {
        description: message,
        duration: 10000,
        style: { whiteSpace: 'pre-line' },
      });
    });

    return () => unsubscribe();
  }, []);

  // Listen to privacy mode trigger from main process idle timer
  useEffect(() => {
    const unsubscribe = ipcClient.on('event:enterPrivacyMode', () => {
      setPrivacyMode(true);
    });
    return () => unsubscribe();
  }, [setPrivacyMode]);

  return (
    <ErrorBoundary>
      <PrivacyOverlay />
      <MainLayout
        currentView={currentView}
        onViewChange={handleViewChange}
        settingsSection={settingsSection}
        onSettingsSectionChange={setSettingsSection}
      >
        {currentView === 'home' && <HomePage />}
        {currentView === 'server' && <ServerPage />}
        {currentView === 'rules' && <RulesPage />}
        {currentView === 'settings' && <SettingsPage activeSection={settingsSection} />}
      </MainLayout>
      <Toaster position="top-right" closeButton />
    </ErrorBoundary>
  );
}

export default App;
