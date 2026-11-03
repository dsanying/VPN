import './global-updates.css';
import { clientHost } from '@/config/client-host';
import { updateKindLabels } from '@/i18n/updateLabels';
import { useEffect, useRef, useState } from 'react';
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
  // store 同步（状态轮询 + 进度推送）+ 非软件更新自动应用。策略：
  //  - core/data/subscriptions（restart=proxy）：发现 ready 即自动 apply，换核/数据刷新由主进程
  //    自动重启代理完成，全自动无提示；软件（restart=software）需退出 App，留给侧边栏
  //    左下角常驻按钮手动触发——那是全应用唯一保留的重启提示。
  //  - apply 走串行队列：主进程同时只允许一个 apply（GlobalUpdateService.applying 互斥），
  //    并发第二个会抛 busy；按 kind:version|revision 指纹去重。
  //  - 失败语义：busy（检查/另一 apply 在飞）→ 摘除指纹，随下次 publish 重试；其余失败
  //    保留指纹不再自动重试（防失败风暴），设置页更新面板（GlobalUpdatePanel）可手动重试。
  const snapshot = useUpdateStore((s) => s.snapshot);
  const autoApplied = useRef<Set<string>>(new Set());
  const autoQueue = useRef<Promise<void>>(Promise.resolve());
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
    for (const item of snapshot.items) {
      if (item.status !== 'ready' || item.restart === 'software') continue;
      const fingerprint = `${item.kind}:${item.version ?? item.revision ?? ''}`;
      if (autoApplied.current.has(fingerprint)) continue;
      autoApplied.current.add(fingerprint);
      autoQueue.current = autoQueue.current.then(async () => {
        try {
          const result = await api.update.apply(item.kind);
          if (!result.success) throw new Error(result.error ?? 'apply failed');
        } catch (error) {
          if (error instanceof Error && error.message.includes('busy')) {
            autoApplied.current.delete(fingerprint);
          }
        }
      });
    }
  }, [snapshot]);
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
