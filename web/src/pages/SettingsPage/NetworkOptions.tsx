import { Form, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { FormGrid, FieldLabel } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import { patchConfig } from '@/store/config-mutations';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { TextSetting } from '@/components/vpn/TextSetting';
import { NumberSetting } from '@/components/vpn/NumberSetting';
import type { UserConfig } from '@shared/types';
export function NetworkOptions() {
  const { t } = useTranslation();
  const config = useAppStore((s) => s.config);
  const change = (patch: Partial<UserConfig>) =>
    void patchConfig((current) => ({ ...current, ...patch }))
      .then(() => notifyActionSuccess('save'))
      .catch((e) => notifyActionFailed('save', e));
  return (
    <Form layout="vertical">
      <FormGrid columns={3}>
        <Form.Item label={<FieldLabel label={t('vpn.mixedPort')} help={t('vpn.mixedPortHint')} />}>
          <NumberSetting
            aria-label={t('vpn.mixedPort')}
            min={1}
            max={65535}
            value={config?.mixedPort ?? 7890}
            onCommit={(value) => patchConfig((current) => ({ ...current, mixedPort: value }))}
          />
        </Form.Item>
        <Form.Item label={<FieldLabel label={t('vpn.allowLan')} help={t('vpn.allowLanHint')} />}>
          <Switch
            aria-label={t('vpn.allowLan')}
            checked={config?.allowLan}
            onChange={(value) => void change({ allowLan: value })}
          />
        </Form.Item>
        <Form.Item
          label={<FieldLabel label={t('vpn.domesticDns')} help={t('vpn.domesticDnsHint')} />}
        >
          <TextSetting
            label={t('vpn.domesticDns')}
            value={config?.dnsConfig?.domesticDns}
            onCommit={(value) =>
              patchConfig((current) => ({
                ...current,
                dnsConfig: {
                  foreignDns: 'https://dns.google/dns-query',
                  ...current.dnsConfig,
                  domesticDns: value,
                },
              }))
            }
          />
        </Form.Item>
        <Form.Item
          label={<FieldLabel label={t('vpn.foreignDns')} help={t('vpn.foreignDnsHint')} />}
        >
          <TextSetting
            label={t('vpn.foreignDns')}
            value={config?.dnsConfig?.foreignDns}
            onCommit={(value) =>
              patchConfig((current) => ({
                ...current,
                dnsConfig: {
                  domesticDns: 'https://doh.pub/dns-query',
                  ...current.dnsConfig,
                  foreignDns: value,
                },
              }))
            }
          />
        </Form.Item>
        <Form.Item label={<FieldLabel label={t('common.vocab.ipv6')} help={t('vpn.ipv6Hint')} />}>
          <Switch
            aria-label={t('common.vocab.ipv6')}
            checked={config?.enableIPv6}
            onChange={(value) => void change({ enableIPv6: value })}
          />
        </Form.Item>
      </FormGrid>
    </Form>
  );
}
