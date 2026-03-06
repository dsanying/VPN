import { ReactNode } from 'react';
import { Sidebar } from './sidebar';

interface MainLayoutProps {
  currentView: string;
  onViewChange: (view: string) => void;
  settingsSection: string;
  onSettingsSectionChange: (section: string) => void;
  children: ReactNode;
}

const isMac = window.electron?.platform === 'darwin';

export function MainLayout({
  currentView,
  onViewChange,
  settingsSection,
  onSettingsSectionChange,
  children,
}: MainLayoutProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden app-shell">
      <Sidebar
        currentView={currentView}
        onViewChange={onViewChange}
        settingsSection={settingsSection}
        onSettingsSectionChange={onSettingsSectionChange}
      />
      <main className="flex-1 overflow-auto flex flex-col relative z-10 main-content-card">
        {isMac && <div className="h-9 flex-shrink-0 app-region-drag" />}
        <div
          className="container mx-auto px-6 pb-6 app-region-no-drag max-w-[1400px]"
          style={{ paddingTop: isMac ? '0' : '24px' }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
