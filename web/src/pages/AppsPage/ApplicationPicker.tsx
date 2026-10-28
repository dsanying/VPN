import { ServerSelect } from '@/components/vpn/ServerSelect';
import { ReloadOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { Alert, Button, Form, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { DrawerForm } from '@/components/client';
import { useInstalledApplications } from '@/hooks/use-installed-applications';
import { ApplicationIdentity } from '@/components/vpn/ApplicationIdentity';
import { patchConfig } from '@/store/config-mutations';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import {
  applicationRuleValues,
  unifiedUserRules,
  withUnifiedUserRules,
} from '@shared/unified-rules';
import type { InstalledApplication, Rule, RuleAction } from '@shared/types';
import { useAppStore } from '@/store/app-store';
import { isServerComplete } from '@shared/server-completeness';
import { isSubscriptionNotice } from '@shared/subscription-notice';
import { actionLabels } from '@/i18n/vpnLabels';

type PickerValues = { applications?: string[]; action: RuleAction; targetServerId?: string };

export function ApplicationPicker({ rule, onClose }: { rule?: Rule; onClose: () => void }) {
  const { t } = useTranslation();
  const config = useAppStore((s) => s.config);
  const [form] = Form.useForm<PickerValues>();
  const action = Form.useWatch('action', form) ?? 'proxy';
  const watched = Form.useWatch('applications', form);
  const nodes =
    config?.servers.filter((n) => isServerComplete(n) && !isSubscriptionNotice(n.name)) ?? [];
  const { applications: apps, loading, error, refresh } = useInstalledApplications();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const selectedIds = (watched ?? []) as string[];
  const ruleApps = rule?.applications ?? [];
  const partialCoverage = selectedIds.some(
    (id) =>
      (apps.find((a) => a.id === id) ?? ruleApps.find((a) => a.id === id))?.coverage ===
      'executable'
  );
  const options = [...apps, ...ruleApps.filter((a) => !apps.some((b) => b.id === a.id))].map(
    (app) => ({
      value: app.id,
      label: (
        <ApplicationIdentity
          application={app}
          name={
            app.coverage === 'unsupported'
              ? `${app.name} · ${t('vpn.unsupportedApplication')}`
              : app.name
          }
        />
      ),
      disabled: app.coverage === 'unsupported',
    })
  );
  const resolve = (id: string) =>
    apps.find((a) => a.id === id) ?? ruleApps.find((a) => a.id === id);
  return (
    <DrawerForm<PickerValues>
      form={form}
      open
      title={rule ? t('common.actions.edit') : t('vpn.addApplication')}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      initialValues={{
        applications: ruleApps.map((a) => a.id),
        action: rule?.action ?? 'proxy',
        targetServerId: rule?.targetServerId,
      }}
      onFinish={async (values) => {
        try {
          const ids = values.applications ?? [];
          if (!ids.length) throw new Error(t('vpn.applicationMissing'));
          // 多选 = 一条规则：applications 收全部选中应用，单一 processPathRegex 条件承载全部进程匹配值，
          // 不再逐应用拆行（拆行使多选失去意义）。编辑态沿用原 id 原槽位，整组替换。
          const applications: InstalledApplication[] = [];
          const valueSet = new Set<string>();
          for (const id of ids) {
            const app = resolve(id);
            if (!app || app.coverage === 'unsupported' || !applicationRuleValues(app).length)
              throw new Error(t('vpn.applicationMissing'));
            // Icons stay in the runtime catalogue, outside persistent routing configuration.
            const { iconDataUrl: _icon, ...identity } = app;
            applications.push(identity);
            for (const value of applicationRuleValues(identity)) valueSet.add(value);
          }
          const draft: Rule = {
            ...(rule ?? {}),
            id: rule?.id ?? crypto.randomUUID(),
            type: 'processPathRegex' as const,
            values: [...valueSet],
            applications,
            enabled: rule?.enabled ?? true,
            action: values.action,
            targetServerId: values.action === 'proxy' ? values.targetServerId : undefined,
          };
          await patchConfig((current) => {
            const all = unifiedUserRules(current);
            if (!rule) return withUnifiedUserRules(current, [draft, ...all]);
            if (!all.some((item) => item.id === rule.id))
              throw new Error(t('vpn.applicationMissing'));
            return withUnifiedUserRules(
              current,
              all.map((item) => (item.id === rule.id ? draft : item))
            );
          });
          notifyActionSuccess('save');
          return true;
        } catch (e) {
          notifyActionFailed('save', e);
          return false;
        }
      }}
    >
      <Form.Item
        name="applications"
        label={t('vpn.chooseApplication')}
        tooltip={t('vpn.applicationScope')}
        rules={[
          {
            validator: async (_, value?: string[]) => {
              if (!value?.length) throw new Error(t('vpn.applicationMissing'));
            },
          },
        ]}
        validateStatus={error ? 'error' : undefined}
        help={error?.message}
      >
        <Select
          mode="multiple"
          maxTagCount="responsive"
          showSearch
          loading={loading}
          aria-label={t('vpn.chooseApplication')}
          options={options}
          filterOption={(input, option) => {
            const app = apps.find((a) => a.id === option?.value);
            return `${app?.name ?? ''} ${app?.path ?? ''}`
              .toLowerCase()
              .includes(input.toLowerCase());
          }}
        />
      </Form.Item>
      {error ? (
        <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void refresh()}>
          {t('common.actions.retry')}
        </Button>
      ) : null}
      {partialCoverage ? <Alert type="warning" title={t('vpn.applicationPartial')} /> : null}
      <Form.Item name="action" label={t('common.vocab.destination')}>
        <Select
          allowClear={false}
          aria-label={t('common.vocab.destination')}
          options={(['proxy', 'direct', 'block'] as const).map((value) => ({
            value,
            label: actionLabels(t)[value],
          }))}
        />
      </Form.Item>
      {action === 'proxy' ? (
        <Form.Item
          name="targetServerId"
          label={t('vpn.target')}
          tooltip={t('vpn.applicationDefaultTarget')}
          rules={[
            {
              validator: async (_, value) => {
                if (!nodes.some((n) => n.id === (value || config?.selectedServerId)))
                  throw new Error(t('vpn.noNodes'));
              },
            },
          ]}
        >
          <ServerSelect
            aria-label={t('vpn.target')}
            servers={nodes}
            subscriptions={config?.subscriptions}
          />
        </Form.Item>
      ) : null}
      <Alert type="info" title={t('vpn.applicationSetupImpact')} />
    </DrawerForm>
  );
}
