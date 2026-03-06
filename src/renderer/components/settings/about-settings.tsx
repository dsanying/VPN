import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Download } from 'lucide-react';
import {
  getVersionInfo,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  openExternal,
  checkCoreUpdate,
  updateCore,
} from '@/bridge/api-wrapper';
import { api } from '@/ipc/api-client';
import type { UpdateProgress } from '@/ipc/api-client';
import { useTranslation } from 'react-i18next';

interface VersionInfo {
  appVersion: string;
  appName: string;
  buildDate: string;
  singBoxVersion: string;
  copyright: string;
  repositoryUrl: string;
}

export function AboutSettings() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkingCoreUpdate, setCheckingCoreUpdate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updatingCore, setUpdatingCore] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const progressUnsubscribeRef = useRef<(() => void) | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    loadVersionInfo();
    // 清理进度监听器
    return () => {
      if (progressUnsubscribeRef.current) {
        progressUnsubscribeRef.current();
      }
    };
  }, []);

  const loadVersionInfo = async () => {
    try {
      setLoading(true);
      const response = await getVersionInfo();
      if (response && response.success && response.data) {
        setVersionInfo(response.data);
      }
    } catch (error) {
      console.error('Failed to load version info:', error);
      toast.error(t('settings.about.loadVersionFail'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAndInstall = async (updateInfo: any) => {
    // 开始监听下载进度
    setDownloading(true);
    setDownloadProgress(0);

    // 订阅进度更新
    progressUnsubscribeRef.current = api.update.onProgress((progress: UpdateProgress) => {
      if (progress.status === 'downloading') {
        setDownloadProgress(progress.percentage);
      } else if (progress.status === 'downloaded') {
        setDownloadProgress(100);
      } else if (progress.status === 'error') {
        setDownloading(false);
        toast.error(t('settings.about.downloadFail'), {
          description: progress.error || progress.message,
          action: {
            label: t('settings.about.manualDownload'),
            onClick: () => openExternal(updateInfo.downloadUrl),
          },
        });
      }
    });

    try {
      const downloadResult = await downloadUpdate(updateInfo);

      // 取消订阅
      if (progressUnsubscribeRef.current) {
        progressUnsubscribeRef.current();
        progressUnsubscribeRef.current = null;
      }

      if (downloadResult.success && downloadResult.data) {
        toast.info(t('settings.about.downloadComplete'));
        setDownloading(false);
        await installUpdate(downloadResult.data);
      } else {
        setDownloading(false);
        toast.error(t('settings.about.downloadFail'), {
          description: downloadResult.error,
          action: {
            label: t('settings.about.manualDownload'),
            onClick: () => openExternal(updateInfo.downloadUrl),
          },
        });
      }
    } catch (error) {
      // 取消订阅
      if (progressUnsubscribeRef.current) {
        progressUnsubscribeRef.current();
        progressUnsubscribeRef.current = null;
      }
      setDownloading(false);
      toast.error(t('settings.about.downloadFail'), {
        description: error instanceof Error ? error.message : t('settings.about.unknownError'),
      });
    }
  };

  const handleCheckUpdate = async () => {
    try {
      setCheckingUpdate(true);
      toast.info(t('settings.about.checkingUpdate'));

      const response = await checkForUpdates();

      if (!response || !response.success) {
        toast.error(t('settings.about.checkUpdateFail'), {
          description: response?.error || t('settings.about.cannotConnectServer'),
        });
        return;
      }

      const data = response.data;
      if (!data) {
        toast.error(t('settings.about.checkUpdateFail'), {
          description: t('settings.about.invalidData'),
        });
        return;
      }

      if (data.hasUpdate && data.updateInfo) {
        const updateInfo = data.updateInfo;
        toast.success(t('settings.about.foundUpdate', { version: updateInfo.version }), {
          description: t('settings.about.clickToInstall'),
          action: {
            label: t('settings.about.updateNow'),
            onClick: () => handleDownloadAndInstall(updateInfo),
          },
          duration: 15000,
        });
      } else {
        toast.success(t('settings.about.alreadyLatest'));
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      toast.error(t('settings.about.checkUpdateFail'), {
        description: error instanceof Error ? error.message : t('settings.about.networkError'),
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleCheckCoreUpdate = async () => {
    try {
      setCheckingCoreUpdate(true);
      toast.info(t('settings.about.checkingCoreUpdate'));

      const response = await checkCoreUpdate();

      if (!response || !response.success) {
        toast.error(t('settings.about.checkCoreUpdateFail'), {
          description: response?.error || t('settings.about.cannotConnectServer'),
        });
        return;
      }

      const data = response.data;

      if (!data) return;

      if (data.hasUpdate && data.latestVersion && data.downloadUrl) {
        toast.success(t('settings.about.foundCoreUpdate', { version: data.latestVersion }), {
          description: t('settings.about.clickToUpdate'),
          action: {
            label: t('settings.about.clickToUpdate'),
            onClick: () => handleUpdateCore(data.downloadUrl!, data.latestVersion!),
          },
          duration: 15000,
        });
      } else if (data.error) {
        toast.error(t('settings.about.checkCoreUpdateFail'), { description: data.error });
      } else {
        toast.success(t('settings.about.coreAlreadyLatest'), {
          description: t('settings.about.currentVersion', { version: data.currentVersion }),
        });
      }
    } catch (error) {
      console.error('Failed to check for core updates:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(t('settings.about.checkCoreUpdateFail'), {
        description: errorMessage || t('settings.about.unknownError'),
      });
    } finally {
      setCheckingCoreUpdate(false);
    }
  };

  const handleUpdateCore = async (downloadUrl: string, version: string) => {
    try {
      setUpdatingCore(true);
      toast.info(t('settings.about.updatingCore', { version }), {
        description: t('settings.about.doNotClose'),
      });

      const response = await updateCore(downloadUrl);

      if (response && response.success && response.data) {
        toast.success(t('settings.about.coreUpdateSuccess'), {
          description: t('settings.about.newCoreActive'),
        });
        // 重新加载版本信息
        loadVersionInfo();
      } else {
        toast.error(t('settings.about.coreUpdateFail'), {
          description: response?.error || t('settings.about.unknownError'),
        });
      }
    } catch (error) {
      toast.error(t('settings.about.coreUpdateFail'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdatingCore(false);
    }
  };

  const handleOpenGitHub = async () => {
    const url = versionInfo?.repositoryUrl || 'https://github.com/dododook/FlowZ';
    await openExternal(url);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.about.title')}</CardTitle>
          <CardDescription>{t('settings.about.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.about.title')}</CardTitle>
        <CardDescription>{t('settings.about.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-muted-foreground">
              {t('settings.about.appVersion')}
            </h4>
            <p className="text-lg font-semibold">
              {versionInfo?.appName || 'FlowZ'} v{versionInfo?.appVersion || '1.0.0'}
            </p>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-medium text-muted-foreground">
              sing-box {t('settings.about.version')}
            </h4>
            <div className="flex items-center gap-4">
              <p className="text-lg font-semibold">{versionInfo?.singBoxVersion || 'Unknown'}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckCoreUpdate}
                disabled={checkingCoreUpdate || updatingCore}
              >
                {(checkingCoreUpdate || updatingCore) && (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                )}
                {updatingCore
                  ? t('settings.about.updating')
                  : checkingCoreUpdate
                    ? t('settings.about.checking')
                    : t('settings.about.checkUpdate')}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            {downloading ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 animate-bounce text-primary" />
                  <span className="text-sm font-medium">
                    {t('settings.about.downloading')} {downloadProgress}%
                  </span>
                </div>
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <Button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="w-full sm:w-auto"
              >
                {checkingUpdate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {checkingUpdate ? t('settings.about.checking') : t('settings.about.checkUpdate')}
              </Button>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t('settings.about.openSource')}
            </h4>
            <Button variant="outline" onClick={handleOpenGitHub} className="w-full sm:w-auto">
              <ExternalLink className="mr-2 h-4 w-4" />
              GitHub
            </Button>
          </div>

          <Separator />

          <div className="text-xs text-muted-foreground space-y-1">
            <p>{versionInfo?.copyright || '© 2025 FlowZ. All rights reserved.'}</p>
            <p>{t('settings.about.builtWith')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
