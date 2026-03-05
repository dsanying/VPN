import {
  GeneralSettings,
  AppearanceSettings,
  AdvancedSettings,
  AboutSettings,
  ProxyModeSettings,
} from '@/components/settings';
import { useTranslation } from 'react-i18next';

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('settings.page.title', '设置')}</h2>
        <p className="text-muted-foreground mt-1">
          {t('settings.page.description', '管理应用程序配置和偏好设置')}
        </p>
      </div>

      <div className="space-y-6">
        <GeneralSettings />
        <ProxyModeSettings />
        <AppearanceSettings />
        <AdvancedSettings />
        <AboutSettings />
      </div>
    </div>
  );
}
