import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { api } from '@/ipc';
import { useTranslation } from 'react-i18next';

export function GeneralSettings() {
  const { t } = useTranslation();
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);

  const handleToggle = async (
    field:
      | 'autoStart'
      | 'autoConnect'
      | 'minimizeToTray'
      | 'autoCheckUpdate'
      | 'autoLightweightMode'
      | 'rememberWindowSize',
    value: boolean
  ) => {
    if (!config) return;

    try {
      if (field === 'autoStart') {
        await api.autoStart.set(value);
      }

      const updatedConfig = {
        ...config,
        [field]: value,
      };

      await saveConfig(updatedConfig);
      toast.success(t('settings.general.successUpdate'));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('settings.general.failUpdate');
      toast.error(errorMessage);
    }
  };

  if (!config) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoStart"
            checked={config.autoStart}
            onCheckedChange={(checked) => handleToggle('autoStart', checked as boolean)}
          />
          <Label
            htmlFor="autoStart"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            {t('settings.general.autoStartTitle')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoConnect"
            checked={config.autoConnect}
            onCheckedChange={(checked) => handleToggle('autoConnect', checked as boolean)}
          />
          <Label
            htmlFor="autoConnect"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            {t('settings.general.autoConnect')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="minimizeToTray"
            checked={config.minimizeToTray}
            onCheckedChange={(checked) => handleToggle('minimizeToTray', checked as boolean)}
          />
          <Label
            htmlFor="minimizeToTray"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            {t('settings.general.minimizeToTrayTitle')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoLightweightMode"
            checked={config.autoLightweightMode}
            onCheckedChange={(checked) => handleToggle('autoLightweightMode', checked as boolean)}
          />
          <Label
            htmlFor="autoLightweightMode"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            {t('settings.general.autoLightweightMode')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoCheckUpdate"
            checked={config.autoCheckUpdate !== false}
            onCheckedChange={(checked) => handleToggle('autoCheckUpdate', checked as boolean)}
          />
          <Label
            htmlFor="autoCheckUpdate"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            {t('settings.general.autoCheckUpdate')}
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="rememberWindowSize"
            checked={config.rememberWindowSize === true}
            onCheckedChange={(checked) => handleToggle('rememberWindowSize', checked as boolean)}
          />
          <Label
            htmlFor="rememberWindowSize"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            {t('settings.general.rememberWindowSize')}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
