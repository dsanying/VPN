import { ConnectionStatusCard } from '@/components/home/connection-status-card';
import { ProxyModeSelector } from '@/components/home/proxy-mode-selector';
import { RealTimeLogs } from '@/components/home/real-time-logs';
import { ConnectionTopology } from '@/components/home/connection-topology';
import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('home.pageTitle', '首页')}</h2>
        <p className="text-muted-foreground mt-1">{t('home.pageDesc', '连接状态和快速操作')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ConnectionStatusCard />
        <ProxyModeSelector />
      </div>

      <ConnectionTopology />

      <RealTimeLogs />
    </div>
  );
}
