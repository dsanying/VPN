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
import { applicationRuleValues, unifiedUserRules, withUnifiedUserRules } from '@shared/unified-rules';
import type { Rule, RuleAction } from '@shared/types';
import { useAppStore } from '@/store/app-store';
import { isServerComplete } from '@shared/server-completeness';
import { isSubscriptionNotice } from '@shared/subscription-notice';
import { actionLabels } from '@/i18n/vpnLabels';

type PickerValues = { application?: string; applications?: string[]; action: RuleAction; targetServerId?: string };

export function ApplicationPicker({ rule, onClose }: { rule?: Rule; onClose: () => void }) {
  const { t } = useTranslation();
  const config = useAppStore(s => s.config);
  const creating = !rule;
  const [form] = Form.useForm<PickerValues>();
  const action = Form.useWatch('action', form) ?? 'proxy';
  const watched = Form.useWatch(creating ? 'applications' : 'application', form);
  const nodes = config?.servers.filter(n => isServerComplete(n) && !isSubscriptionNotice(n.name)) ?? [];
  const { applications: apps, loading, error, refresh } = useInstalledApplications();
  useEffect(() => { void refresh(); }, [refresh]);
  const selectedIds = creating ? (watched ?? []) as string[] : watched ? [watched as string] : [];
  const partialCoverage = selectedIds.some(id => (apps.find(a => a.id === id) ?? (id === rule?.application?.id ? rule.application : undefined))?.coverage === 'executable');
  const options = [...apps,...(rule?.application&&!apps.some(a=>a.id===rule.application?.id)?[rule.application]:[])].map(app => ({ value: app.id, label: <ApplicationIdentity application={app} name={app.coverage === 'unsupported' ? `${app.name} · ${t('vpn.unsupportedApplication')}` : app.name} />, disabled: app.coverage === 'unsupported' }));
  const resolve = (id: string) => apps.find(a => a.id === id) ?? (id === rule?.application?.id ? rule.application : undefined);
  return <DrawerForm<PickerValues> form={form} open title={rule?t('common.actions.edit'):t('vpn.addApplication')} onOpenChange={value => { if (!value) onClose(); }} initialValues={{ application:rule?.application?.id, applications:rule?.application ? [rule.application.id] : [], action:rule?.action??'proxy', targetServerId:rule?.targetServerId }} onFinish={async values => {
    try {
      const ids = creating ? (values.applications ?? []) : values.application ? [values.application] : [];
      if (!ids.length) throw new Error(t('vpn.applicationMissing'));
      const drafts: Rule[] = ids.map(id => {
        const app = resolve(id);
        if (!app || app.coverage === 'unsupported' || !applicationRuleValues(app).length) throw new Error(t('vpn.applicationMissing'));
        // Icons stay in the runtime catalogue, outside persistent routing configuration.
        const { iconDataUrl: _icon, ...identity } = app;
        return { ...(id === rule?.application?.id ? rule : {}), id: id === rule?.application?.id && rule ? rule.id : crypto.randomUUID(), type:'processPathRegex' as const, values:applicationRuleValues(identity), application:identity,
          enabled:rule?.enabled??true, action:values.action, targetServerId:values.action==='proxy'?values.targetServerId:undefined };
      });
      await patchConfig(current => withUnifiedUserRules(current, rule ? unifiedUserRules(current).map(r=>r.id===rule.id?drafts[0]:r).concat(drafts.slice(1)) : [...drafts,...unifiedUserRules(current)]));
      notifyActionSuccess('save'); return true;
    } catch (e) { notifyActionFailed('save', e); return false; }
  }}>
    {creating ? (
      <Form.Item name="applications" label={t('vpn.chooseApplication')} tooltip={t('vpn.applicationScope')} rules={[{ validator: async (_, value?: string[]) => { if (!value?.length) throw new Error(t('vpn.applicationMissing')); } }]} validateStatus={error ? 'error' : undefined} help={error?.message}>
        <Select mode="multiple" maxTagCount="responsive" showSearch loading={loading} aria-label={t('vpn.chooseApplication')} options={options} filterOption={(input, option) => { const app = apps.find(a => a.id === option?.value); return `${app?.name ?? ''} ${app?.path ?? ''}`.toLowerCase().includes(input.toLowerCase()); }} />
      </Form.Item>
    ) : (
      <Form.Item name="application" label={t('vpn.chooseApplication')} tooltip={t('vpn.applicationScope')} rules={[{ required: true }]} validateStatus={error ? 'error' : undefined} help={error?.message}>
        <Select allowClear showSearch loading={loading} aria-label={t('vpn.chooseApplication')} options={options} filterOption={(input, option) => { const app = apps.find(a => a.id === option?.value); return `${app?.name ?? ''} ${app?.path ?? ''}`.toLowerCase().includes(input.toLowerCase()); }} />
      </Form.Item>
    )}
    {error ? <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void refresh()}>{t('common.actions.retry')}</Button> : null}
    {partialCoverage ? <Alert type="warning" title={t('vpn.applicationPartial')} /> : null}
    <Form.Item name="action" label={t('common.vocab.destination')}><Select allowClear={false} aria-label={t('common.vocab.destination')} options={(['proxy', 'direct', 'block'] as const).map(value => ({ value, label: actionLabels(t)[value] }))} /></Form.Item>
    {action === 'proxy' ? <Form.Item name="targetServerId" label={t('vpn.target')} tooltip={t('vpn.applicationDefaultTarget')} rules={[{ validator: async (_, value) => { if (!nodes.some(n => n.id === (value || config?.selectedServerId))) throw new Error(t('vpn.noNodes')); } }]}><ServerSelect aria-label={t('vpn.target')} servers={nodes} subscriptions={config?.subscriptions} /></Form.Item> : null}
    <Alert type="info" title={t('vpn.applicationSetupImpact')} />
  </DrawerForm>;
}
