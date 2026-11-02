import './global-updates.css';
import { clientHost } from '@/config/client-host';
import { updateKindLabels } from '@/i18n/updateLabels';
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api } from '@/ipc';
import { useUpdateStore } from '@/store/update-store';
import { ContentStack, ResponsiveActions } from '@/components/client';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';

export function UpdateActions() {
  const { t } = useTranslation();
  const snapshot = useUpdateStore((s) => s.snapshot);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <ResponsiveActions justify="start">
      {snapshot.items
        .filter((item) => item.status === 'ready')
        .filter(
          (item, index, items) =>
            items.findIndex((entry) => entry.restart === item.restart) === index
        )
        .map((item) => (
          <Button
            key={item.kind}
            icon={<SyncOutlined aria-hidden />}
            className="ds-update-restart"
            variant="outlined"
            loading={busy === item.kind}
            disabled={busy !== null && busy !== item.kind}
            onClick={() => {
              setBusy(item.kind);
              void api.update
                .apply(item.kind)
                .then((result) => {
                  if (!result.success) throw new Error(result.error);
                  // Native Android installation is completed by the system, after its visible confirmation.
                  if (!result.installationRequested && !result.permissionRequired)
                    notifyActionSuccess('update');
                })
                .catch((error) => notifyActionFailed('update', error))
                .finally(() => setBusy(null));
            }}
          >
            {t(
              clientHost().bundledCore
                ? 'vpn.installSoftwareUpdate'
                : item.restart === 'software'
                  ? 'vpn.restartSoftwareUpdate'
                  : 'vpn.restartProxyUpdate'
            )}
          </Button>
        ))}
    </ResponsiveActions>
  );
}

export function GlobalUpdateNotice() {
  // 只做 store 同步（状态轮询 + 进度推送），不再自动弹 toast：更新就绪的入口统一收敛到
  // 侧边栏左下角常驻按钮（BasicLayout）与设置页 GlobalUpdatePanel，弹窗与常驻按钮二选一，弹窗属打扰。
  useEffect(() => {
    const off = api.update.onProgress((progress) => {
      if (progress.globalUpdates) useUpdateStore.getState().setSnapshot(progress.globalUpdates);
    });
    void api.update
      .status()
      .then((result) => {
        if (result?.globalUpdates) useUpdateStore.getState().setSnapshot(result.globalUpdates);
      })
      .catch(() => {});
    return off;
  }, []);
  return null;
}

export function GlobalUpdatePanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <ContentStack>
      <ResponsiveActions justify="start">
        <Button
          icon={<ReloadOutlined aria-hidden />}
          loading={busy}
          onClick={() => {
            setBusy(true);
            void api.update
              .check()
              .then((result) => {
                if (result.error) throw new Error(result.error);
                if (result.globalUpdates) {
                  useUpdateStore.getState().setSnapshot(result.globalUpdates);
                  const failures = result.globalUpdates.items.filter(
                    (item) => (item.kind === 'software' || item.kind === 'core') && item.error
                  );
                  if (failures.length)
                    throw new Error(
                      failures
                        .map((item) => `${updateKindLabels(t)[item.kind]}: ${item.error}`)
                        .join('\n')
                    );
                }
                notifyActionSuccess('checkUpdate');
              })
              .catch((error) => notifyActionFailed('checkUpdate', error))
              .finally(() => setBusy(false));
          }}
        >
          {t('vpn.checkUpdate')}
        </Button>
      </ResponsiveActions>
      <UpdateActions />
    </ContentStack>
  );
}
