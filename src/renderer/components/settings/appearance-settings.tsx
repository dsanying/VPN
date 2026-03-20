import { Card, CardContent } from '@/components/ui/card';
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
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';

export function AppearanceSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const handleThemeChange = (value: string) => {
    setTheme(value as 'light' | 'dark' | 'system');
    toast.success(t('settings.appearance.title'));
  };

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem('app-language', value);
    toast.success(value === 'zh-CN' ? '语言已切换为简体中文' : 'Language switched to English');
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <Label htmlFor="theme">{t('settings.appearance.theme')}</Label>
          <Select value={theme} onValueChange={handleThemeChange}>
            <SelectTrigger id="theme">
              <SelectValue placeholder={t('settings.appearance.selectTheme')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{t('settings.appearance.light')}</SelectItem>
              <SelectItem value="dark">{t('settings.appearance.dark')}</SelectItem>
              <SelectItem value="system">{t('settings.appearance.system')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="language">{t('settings.appearance.language')}</Label>
          <Select value={i18n.language} onValueChange={handleLanguageChange}>
            <SelectTrigger id="language">
              <SelectValue placeholder={t('settings.appearance.selectLanguage')} />
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
