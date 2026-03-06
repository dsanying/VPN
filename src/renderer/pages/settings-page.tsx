import {
  GeneralSettings,
  AppearanceSettings,
  AdvancedSettings,
  AboutSettings,
  ProxyModeSettings,
} from '@/components/settings';
import { useTranslation } from 'react-i18next';

interface SettingsPageProps {
  activeSection: string;
}

const sectionTitles: Record<
  string,
  { titleKey: string; defaultTitle: string; descKey: string; defaultDesc: string }
> = {
  general: {
    titleKey: 'settings.general.title',
    defaultTitle: '常规',
    descKey: 'settings.general.description',
    defaultDesc: '应用程序启动和行为设置',
  },
  proxyMode: {
    titleKey: 'settings.proxyMode.title',
    defaultTitle: '代理模式',
    descKey: 'settings.proxyMode.description',
    defaultDesc: '选择代理实现方式',
  },
  appearance: {
    titleKey: 'settings.appearance.title',
    defaultTitle: '外观',
    descKey: 'settings.appearance.description',
    defaultDesc: '自定义应用程序的外观',
  },
  advanced: {
    titleKey: 'settings.advanced.title',
    defaultTitle: '高级',
    descKey: 'settings.advanced.description',
    defaultDesc: '高级网络和系统配置',
  },
  about: {
    titleKey: 'settings.about.title',
    defaultTitle: '关于',
    descKey: 'settings.about.description',
    defaultDesc: '版本信息和更新',
  },
};

export function SettingsPage({ activeSection }: SettingsPageProps) {
  const { t } = useTranslation();
  const meta = sectionTitles[activeSection] ?? sectionTitles.general;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t(meta.titleKey, meta.defaultTitle)}</h2>
        <p className="text-muted-foreground mt-1">{t(meta.descKey, meta.defaultDesc)}</p>
      </div>

      <div>
        {activeSection === 'general' && <GeneralSettings />}
        {activeSection === 'proxyMode' && <ProxyModeSettings />}
        {activeSection === 'appearance' && <AppearanceSettings />}
        {activeSection === 'advanced' && <AdvancedSettings />}
        {activeSection === 'about' && <AboutSettings />}
      </div>
    </div>
  );
}
