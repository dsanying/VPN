import { clientHost } from '@/config/client-host';
import { GlobalUpdatePanel } from '@/components/vpn/GlobalUpdates';
import { backupLabels } from '@/i18n/vpnLabels';
import { DownloadOutlined, UploadOutlined, ClearOutlined } from '@ant-design/icons';
import { Button, Form, Checkbox } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRequest } from '@/hooks/useRequest';
import { api } from '@/ipc';
import { useAppStore } from '@/store/app-store';
import {
  HelpTip,
  ContentStack,
  DrawerForm,
  SummaryStrip,
  QueryErrorAlert,
  Popconfirm,
  ResponsiveActions,
} from '@/components/client';
import { notifyActionFailed, notifyActionSuccess, type WriteAction } from '@/utils/feedback';
import { BACKUP_CATEGORIES, type BackupCategory } from '@shared/backup-categories';

export function SettingsTools() {
  const { t } = useTranslation();
  const version = useRequest(() => api.version.getInfo());
  return (
    <ContentStack>
      {version.error ? (
        <QueryErrorAlert
          error={version.error}
          errorTitle={t('errors.configNotLoaded')}
          onRetry={version.run}
          retryLabel={t('common.actions.retry')}
        />
      ) : null}
      <SummaryStrip
        compact
        label={t('common.actions.update')}
        items={[
          { key: 'app', label: t('common.vocab.version'), value: version.data?.appVersion },
          {
            key: 'core',
            label: (
              <>
                {t('common.vocab.core')}
                {clientHost().bundledCore ? <HelpTip title={t('vpn.bundledCoreHint')} /> : null}
              </>
            ),
            value: version.data?.singBoxVersion,
          },
        ]}
      />
      <GlobalUpdatePanel />
    </ContentStack>
  );
}

export function BackupTools() {
  const { t } = useTranslation();
  const [backupPath, setBackupPath] = useState<string>();
  const [categories, setCategories] = useState<BackupCategory[]>([...BACKUP_CATEGORIES]);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<unknown>, action: WriteAction) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      notifyActionFailed(action, e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ContentStack>
      <ResponsiveActions justify="start">
        <Button
          icon={<DownloadOutlined aria-hidden />}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api.backup.export();
              if (!result.success && result.error && result.error !== 'cancelled')
                throw new Error(result.error);
              if (result.success) notifyActionSuccess('export');
            }, 'export')
          }
        >
          {t('common.actions.export')}
        </Button>
        <Button
          icon={<UploadOutlined aria-hidden />}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api.backup.importPick();
              if (result.error) throw new Error(result.error);
              if (result.filePath) {
                setBackupPath(result.filePath);
                setCategories(result.available ?? []);
              }
            }, 'save')
          }
        >
          {t('common.vocab.restore')}
        </Button>
      </ResponsiveActions>
      {backupPath ? (
        <DrawerForm
          open
          title={t('vpn.backup')}
          onOpenChange={(open) => {
            if (!open && !busy) setBackupPath(undefined);
          }}
          submitter={false}
        >
          <Form.Item label={t('vpn.backup')}>
            <Checkbox.Group
              disabled={busy}
              value={categories}
              onChange={(values) => setCategories(values as BackupCategory[])}
              options={BACKUP_CATEGORIES.map((value) => ({ value, label: backupLabels(t)[value] }))}
            />
          </Form.Item>
          <Popconfirm
            title={t('common.confirm.execute')}
            description={t('vpn.restoreImpact')}
            onConfirm={() =>
              run(async () => {
                const result = await api.backup.importApply(backupPath, categories);
                if (!result.success) throw new Error(result.error);
                await useAppStore.getState().loadConfig();
                setBackupPath(undefined);
                notifyActionSuccess('save');
              }, 'save')
            }
          >
            <Button
              icon={<ClearOutlined aria-hidden />}
              color="danger"
              variant="outlined"
              loading={busy}
              disabled={!categories.length}
            >
              {t('common.vocab.restore')}
            </Button>
          </Popconfirm>
        </DrawerForm>
      ) : null}
    </ContentStack>
  );
}
