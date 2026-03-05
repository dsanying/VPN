import { Home, Server, ListFilter, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

const navItems = [
  { id: 'home', icon: Home },
  { id: 'server', icon: Server },
  { id: 'rules', icon: ListFilter },
  { id: 'settings', icon: Settings },
];

const isMac = window.electron?.platform === 'darwin';

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="w-[180px] sidebar h-full flex flex-col relative z-20">
      <div className={cn('p-4 border-b border-transparent', isMac && 'pt-[34px] app-region-drag')}>
        <h1 className="text-sm font-bold pl-2 text-foreground/80">FlowZ</h1>
      </div>
      <nav className="flex-1 pt-2 pb-2 app-region-no-drag space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'w-[calc(100%-1rem)] mx-2 flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors mb-0.5',
                currentView === item.id
                  ? 'bg-black/[0.06] text-foreground font-medium shadow-sm dark:bg-white/15 dark:text-foreground'
                  : 'text-muted-foreground/80 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/5 dark:hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 stroke-[2px]" />
              <span>{t(`sidebar.${item.id}`)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
