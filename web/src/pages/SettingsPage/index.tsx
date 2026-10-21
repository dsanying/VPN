import { clientHost } from '@/config/client-host';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { Button, Form, Select, Switch } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppPage,
  PageStack,
  FormGrid,
  ResponsiveActions,
  StatusTag,
  ViewSwitch,
  FieldLabel,
} from '@/components/client';
import { ConfigBoundary } from '@/components/vpn/ConfigBoundary';
import { DesktopSection } from '@/components/vpn/DesktopSection';
import { useAppStore } from '@/store/app-store';
import { useThemeStore } from '@/store/useThemeStore';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { api } from '@/ipc';
import type { UserConfig } from '@shared/types';
import { LOGIN_ITEMS_SETTINGS_URL } from '@shared/constants';
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
            <DesktopSection
              title={t('common.vocab.helper')}
              tooltip={t('vpn.helperPurpose')}
              extra={
                <StatusTag
                  tone={
                    helper?.ready && !helper.needsRepair
                      ? 'success'
                      : helper?.needsRepair
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {t(
                    helper?.ready && !helper.needsRepair
                      ? 'common.vocab.ready'
                      : helper?.needsRepair
                        ? 'vpn.helperNeedsRepair'
                        : helper?.installed
                          ? 'vpn.helperUnavailable'
                          : 'vpn.helperMissing'
                  )}
                </StatusTag>
              }
            >
              {helper?.supported ? (
                <>
                  {!helper.ready || helper.needsRepair ? (
                    <ResponsiveActions justify="start">
                      <Button
                        icon={<SafetyCertificateOutlined aria-hidden />}
                        loading={helperBusy}
                        onClick={() => void helperAction()}
                      >
                        {t(helper.installed ? 'vpn.repairHelper' : 'common.vocab.install')}
                      </Button>
                    </ResponsiveActions>
                  ) : null}
                  {helper.backgroundDisabled ? (
                    <ResponsiveActions justify="start">
                      <span>{t('vpn.helperBackgroundOffHint')}</span>
                      <Button
                        onClick={() =>
                          void api.system
                            .openExternal(LOGIN_ITEMS_SETTINGS_URL)
                            .catch((e) => notifyActionFailed('openSettings', e))
                        }
                      >
                        {t('vpn.openSettings')}
                      </Button>
                    </ResponsiveActions>
                  ) : null}
                </>
              ) : (
                <span>{t('vpn.notInstalledPlatform')}</span>
              )}
            </DesktopSection>
          ) : (
            <DesktopSection
              title={t('vpn.systemVpn')}
              tooltip={t('vpn.systemVpnHint')}
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
            >
              {null}
            </DesktopSection>
          )}
          <DesktopSection title={t('common.vocab.general')}>
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
          </DesktopSection>
          <DesktopSection title={t('common.vocab.networkSettings')}>
            <NetworkOptions />
          </DesktopSection>
          <DesktopSection title={t('common.actions.update')}>
            <SettingsTools />
          </DesktopSection>
          <DesktopSection title={t('vpn.backup')}>
            <BackupTools />
          </DesktopSection>
        </PageStack>
      </ConfigBoundary>
    </AppPage>
  );
}
