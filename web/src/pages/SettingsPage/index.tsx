import { clientHost } from '@/config/client-host';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { Button, Card, Form, Select, Switch, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppPage,
  PageStack,
  FormGrid,
  ResponsiveActions,
  StatusTag,
  ViewSwitch,
  HelpTip,
  FieldLabel,
  SectionHeader,
  ContentStack,
} from '@/components/client';
import { ConfigBoundary } from '@/components/vpn/ConfigBoundary';
import { useAppStore } from '@/store/app-store';
import { useThemeStore } from '@/stores/useThemeStore';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { api } from '@/ipc';
import type { UserConfig } from '@shared/types';
import { patchConfig } from '@/store/config-mutations';
import { NetworkOptions } from './NetworkOptions';
import { SettingsTools, BackupTools } from './SettingsTools';
export default function SettingsPage() {
  const config = useAppStore((s) => s.config);
  const helper = useAppStore((s) => s.helperStatus);
  const mode = useThemeStore((s) => s.preference);
  const setTheme = useThemeStore((s) => s.setPreference);
  const host = clientHost();
  const [helperBusy, setHelperBusy] = useState(false);
  const { t, i18n } = useTranslation();
  const change = async (patch: Partial<UserConfig>) => {
    if (!config) return;
    try {
      if (patch.autoStart !== undefined && !(await api.autoStart.set(patch.autoStart)))
        throw new Error(t('common.requestFailed'));
      await patchConfig((current) => ({ ...current, ...patch }));
      notifyActionSuccess('save');
    } catch (e) {
      notifyActionFailed('save', e);
    }
  };
  const helperAction = async () => {
    setHelperBusy(true);
    try {
      const result = await api.helper.install();
      useAppStore.setState({ helperStatus: result.status });
      if (!result.success) throw new Error(result.error);
      notifyActionSuccess('install', t('common.vocab.helper'));
    } catch (e) {
      notifyActionFailed('install', e);
    } finally {
      setHelperBusy(false);
    }
  };
  return (
    <AppPage showBreadcrumb={false}>
      <ConfigBoundary>
        <PageStack>
          {host.desktopHelper ? (
            <ContentStack>
              <SectionHeader
                title={
                  <Space size="small">
                    {t('common.vocab.helper')}
                    <HelpTip title={t('vpn.helperPurpose')} />
                  </Space>
                }
                extra={
                  <StatusTag tone={helper?.ready ? 'success' : 'neutral'}>
                    {t(
                      helper?.ready
                        ? 'common.vocab.ready'
                        : helper?.installed
                          ? 'vpn.helperUnavailable'
                          : 'vpn.helperMissing'
                    )}
                  </StatusTag>
                }
              />
              {helper?.supported ? (
                !helper.ready ? (
                  <ResponsiveActions justify="start">
                    <Button
                      icon={<SafetyCertificateOutlined aria-hidden />}
                      loading={helperBusy}
                      onClick={() => void helperAction()}
                    >
                      {t(helper.installed ? 'vpn.repairHelper' : 'common.vocab.install')}
                    </Button>
                  </ResponsiveActions>
                ) : null
              ) : (
                <span>{t('vpn.notInstalledPlatform')}</span>
              )}
            </ContentStack>
          ) : (
            <ContentStack>
              <SectionHeader
                title={
                  <Space size="small">
                    {t('vpn.systemVpn')}
                    <HelpTip title={t('vpn.systemVpnHint')} />
                  </Space>
                }
                extra={
                  <Button
                    onClick={() =>
                      void api.system
                        .openVpnSettings()
                        .catch((error) => notifyActionFailed('openSettings', error))
                    }
                  >
                    {t('common.actions.manage')}
                  </Button>
                }
              />
            </ContentStack>
          )}
          <Card title={t('common.vocab.general')}>
            <Form layout="vertical">
              <FormGrid columns={3}>
                {host.loginAutostart ? (
                  <Form.Item
                    label={<FieldLabel label={t('vpn.autoStart')} help={t('vpn.autoStartHint')} />}
                  >
                    <Switch
                      aria-label={t('vpn.autoStart')}
                      checked={config?.autoStart}
                      onChange={(value) => void change({ autoStart: value })}
                    />
                  </Form.Item>
                ) : null}
                <Form.Item
                  label={
                    <FieldLabel label={t('vpn.autoConnect')} help={t('vpn.autoConnectHint')} />
                  }
                >
                  <Switch
                    aria-label={t('vpn.autoConnect')}
                    checked={config?.autoConnect}
                    onChange={(value) => void change({ autoConnect: value })}
                  />
                </Form.Item>
                {host.tray ? (
                  <Form.Item
                    label={
                      <FieldLabel
                        label={t('vpn.minimizeToTray')}
                        help={t('vpn.minimizeToTrayHint')}
                      />
                    }
                  >
                    <Switch
                      aria-label={t('vpn.minimizeToTray')}
                      checked={config?.minimizeToTray}
                      onChange={(value) => void change({ minimizeToTray: value })}
                    />
                  </Form.Item>
                ) : null}
                {host.failover ? (
                  <Form.Item
                    label={
                      <FieldLabel
                        label={t('vpn.autoSwitchNode')}
                        help={t('vpn.autoSwitchNodeHint')}
                      />
                    }
                  >
                    <Switch
                      aria-label={t('vpn.autoSwitchNode')}
                      checked={config?.autoSwitchNode}
                      onChange={(value) => void change({ autoSwitchNode: value })}
                    />
                  </Form.Item>
                ) : null}
                <Form.Item label={t('vpn.theme')}>
                  <ViewSwitch
                    value={mode}
                    onChange={setTheme}
                    options={[
                      { value: 'system', label: t('common.vocab.system') },
                      { value: 'light', label: t('vpn.light') },
                      { value: 'dark', label: t('vpn.dark') },
                    ]}
                  />
                </Form.Item>
                <Form.Item label={t('common.vocab.language')}>
                  <Select
                    aria-label={t('common.vocab.language')}
                    allowClear={false}
                    value={i18n.language}
                    options={[
                      { value: 'zh-CN', label: t('common.vocab.chinese') },
                      { value: 'en-US', label: t('vpn.english') },
                    ]}
                    onChange={(value) => void i18n.changeLanguage(value)}
                  />
                </Form.Item>
              </FormGrid>
            </Form>
          </Card>
          <Card title={t('common.vocab.networkSettings')}>
            <NetworkOptions />
          </Card>
          <Card title={t('common.actions.update')}>
            <SettingsTools />
          </Card>
          <Card title={t('vpn.backup')}>
            <BackupTools />
          </Card>
        </PageStack>
      </ConfigBoundary>
    </AppPage>
  );
}
