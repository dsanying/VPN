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
    <div className="flex h-screen w-full bg-transparent overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={onViewChange} />
      <main className="flex-1 overflow-auto flex flex-col relative z-10 main-content-card mt-0 ml-2 mb-2 mr-2 md:m-0 md:rounded-tl-xl md:rounded-bl-none md:border-t-0 md:border-r-0 md:border-b-0">
        {isMac && <div className="h-8 flex-shrink-0 app-region-drag" />}
        <div className="container mx-auto p-6 app-region-no-drag max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
