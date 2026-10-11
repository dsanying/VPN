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
import {
  notifyActionFailed,
  notifyActionSuccess,
  showPendingUpdates,
  closePendingUpdates,
} from '@/utils/feedback';

export function UpdateActions() {
  const { t } = useTranslation();
  const snapshot = useUpdateStore((s) => s.snapshot);
  const [busy, setBusy] = useState(false);
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
            loading={busy}
            disabled={snapshot.checking}
            onClick={() => {
              setBusy(true);
              void api.update
                .apply(item.kind)
                .then((result) => {
                  if (!result.success) throw new Error(result.error);
                  // Native Android installation is completed by the system, after its visible confirmation.
                  if (!result.installationRequested && !result.permissionRequired)
                    notifyActionSuccess('update');
                })
                .catch((error) => notifyActionFailed('update', error))
                .finally(() => setBusy(false));
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
  const { t } = useTranslation();
  const snapshot = useUpdateStore((s) => s.snapshot);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const fingerprint = snapshot.items
    .filter((item) => item.status === 'ready')
    .map((item) => `${item.kind}:${item.version ?? item.revision ?? ''}`)
    .sort()
    .join('|');
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
  useEffect(() => {
    if (!fingerprint || fingerprint === dismissed) {
      closePendingUpdates();
      return;
    }
    showPendingUpdates(t('vpn.pendingUpdates'), <UpdateActions />, () =>
      useUpdateStore.getState().dismiss(fingerprint)
    );
    return closePendingUpdates;
  }, [fingerprint, dismissed, t]);
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
