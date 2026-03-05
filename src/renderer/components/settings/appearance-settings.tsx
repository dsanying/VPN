import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTheme } from '@/components/theme-provider';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation();

  const handleThemeChange = (value: string) => {
    setTheme(value as 'light' | 'dark' | 'system');
    toast.success(t('settings.appearance.themeUpdated', '主题已更新'));
  };

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem('app-language', value);
    toast.success(
      t('settings.appearance.langUpdated', value === 'en-US' ? 'Language updated' : '语言已更新')
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance.title', '外观')}</CardTitle>
        <CardDescription>
          {t('settings.appearance.description', '自定义应用程序的外观')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="theme">{t('settings.appearance.theme', '主题')}</Label>
          <Select value={theme} onValueChange={handleThemeChange}>
            <SelectTrigger id="theme">
              <SelectValue placeholder={t('settings.appearance.selectTheme', '选择主题')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{t('settings.appearance.light', '浅色')}</SelectItem>
              <SelectItem value="dark">{t('settings.appearance.dark', '深色')}</SelectItem>
              <SelectItem value="system">{t('settings.appearance.system', '跟随系统')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="language">{t('settings.appearance.language', '语言')}</Label>
          <Select value={i18n.language || 'zh-CN'} onValueChange={handleLanguageChange}>
            <SelectTrigger id="language">
              <SelectValue placeholder={t('settings.appearance.selectLanguage', '选择语言')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">简体中文</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
