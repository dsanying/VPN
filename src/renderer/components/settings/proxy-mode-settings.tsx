import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ProxyModeType } from '@/bridge/types';
import { useTranslation } from 'react-i18next';

export function ProxyModeSettings() {
  const { t } = useTranslation();
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const connectionStatus = useAppStore((state) => state.connectionStatus);

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingModeType, setPendingModeType] = useState<ProxyModeType | null>(null);

  if (!config) {
    return null;
  }

  const proxyModeType = connectionStatus?.proxyModeType || config?.proxyModeType || 'systemProxy';
  const isTunMode = proxyModeType === 'tun';
  const isManualMode = proxyModeType === 'manual';
  const isConnected =
    isTunMode || isManualMode
      ? connectionStatus?.proxyCore?.running === true
      : connectionStatus?.proxyCore?.running && connectionStatus?.proxy?.enabled;

  const handleModeTypeChange = (value: ProxyModeType) => {
    if (isConnected) {
      setPendingModeType(value);
      setShowConfirmDialog(true);
    } else {
      applyModeTypeChange(value);
    }
  };

  const applyModeTypeChange = async (modeType: ProxyModeType) => {
    try {
      const updatedConfig = {
        ...config,
        proxyModeType: modeType,
      };

      await saveConfig(updatedConfig);
      toast.success(t('settings.proxyMode.successUpdate'), {
        description: isConnected ? t('settings.proxyMode.reconnectToast') : undefined,
      });
    } catch {
      toast.error(t('settings.proxyMode.failUpdate'));
    }
  };

  const handleConfirmModeChange = () => {
    if (pendingModeType) {
      applyModeTypeChange(pendingModeType);
      setPendingModeType(null);
    }
    setShowConfirmDialog(false);
  };

  return (
    <>
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-3">
            <Label>{t('settings.proxyMode.implementationMode')}</Label>
            <RadioGroup
              value={config.proxyModeType}
              onValueChange={(value) => handleModeTypeChange(value as ProxyModeType)}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="systemProxy" id="system-proxy" />
                <Label htmlFor="system-proxy" className="cursor-pointer font-normal">
                  <div>
                    <div className="font-medium">{t('settings.proxyMode.systemProxyMode')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('settings.proxyMode.systemProxyModeDesc')}
                    </div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="tun" id="tun-mode" />
                <Label htmlFor="tun-mode" className="cursor-pointer font-normal">
                  <div>
                    <div className="font-medium">{t('settings.proxyMode.tunMode')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('settings.proxyMode.tunModeDesc')}
                    </div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="manual" id="manual-mode" />
                <Label htmlFor="manual-mode" className="cursor-pointer font-normal">
                  <div>
                    <div className="font-medium">{t('settings.proxyMode.manualProxyMode')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('settings.proxyMode.manualProxyModeDesc')}
                    </div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground mt-2">
              {t('settings.proxyMode.tunModeNote')}
            </p>
          </div>

          {isConnected && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                {t('settings.proxyMode.reconnectWarning')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.proxyMode.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.proxyMode.confirmDesc')}
              <br />
              <br />
              {t('settings.proxyMode.confirmSwitch')}
              <strong>
                {pendingModeType === 'tun'
                  ? t('settings.proxyMode.tunMode')
                  : pendingModeType === 'manual'
                    ? t('settings.proxyMode.manualProxyMode')
                    : t('settings.proxyMode.systemProxyMode')}
              </strong>
              {t('settings.proxyMode.confirmQuestion')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingModeType(null)}>
              {t('settings.proxyMode.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmModeChange}>
              {t('settings.proxyMode.confirmBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
