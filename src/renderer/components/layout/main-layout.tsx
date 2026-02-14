import { ReactNode } from 'react';
import { Sidebar } from './sidebar';

interface MainLayoutProps {
  currentView: string;
  onViewChange: (view: string) => void;
  children: ReactNode;
}

const isMac = window.electron?.platform === 'darwin';

export function MainLayout({ currentView, onViewChange, children }: MainLayoutProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={onViewChange} />
      <main className="flex-1 overflow-auto flex flex-col">
        {isMac && <div className="h-8 flex-shrink-0 app-region-drag" />}
        <div className="container mx-auto p-6 app-region-no-drag">{children}</div>
      </main>
    </div>
  );
}
