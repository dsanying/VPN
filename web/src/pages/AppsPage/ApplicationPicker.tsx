import { ServerSelect } from '@/components/vpn/ServerSelect';
import { ReloadOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { DrawerForm } from '@/components/client';
import { useInstalledApplications } from '@/hooks/use-installed-applications';
import { ApplicationIdentity } from '@/components/vpn/ApplicationIdentity';
import { patchConfig } from '@/store/config-mutations';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { applicationRuleValues, unifiedUserRules, withUnifiedUserRules } from '@shared/unified-rules';
import type { InstalledApplication, Rule, RuleAction } from '@shared/types';
import { useAppStore } from '@/store/app-store';
import { isServerComplete } from '@shared/server-completeness';
import { isSubscriptionNotice } from '@shared/subscription-notice';
import { actionLabels } from '@/i18n/vpnLabels';

export function ApplicationPicker({ rule, onClose }: { rule?: Rule; onClose: () => void }) {
  const { t } = useTranslation();
  const config = useAppStore(s => s.config);
  const [form] = Form.useForm<{ application: string; action: RuleAction; targetServerId?: string }>();
  const action = Form.useWatch('action', form) ?? 'proxy';
  const nodes = config?.servers.filter(n => isServerComplete(n) && !isSubscriptionNotice(n.name)) ?? [];
  const { applications: apps, loading, error, refresh } = useInstalledApplications();
  useEffect(() => { void refresh(); }, [refresh]);
  const [selected, setSelected] = useState<InstalledApplication>();
  return <DrawerForm<{ application: string; action: RuleAction; targetServerId?: string }> form={form} open title={rule?t('common.actions.edit'):t('vpn.addApplication')} onOpenChange={value => { if (!value) onClose(); }} initialValues={{ application:rule?.application?.id,action:rule?.action??'proxy',targetServerId:rule?.targetServerId }} onFinish={async values => {
    try {
      const app = apps.find(a => a.id === values.application) ?? (values.application===rule?.application?.id?rule.application:undefined);
      if (!app || app.coverage === 'unsupported' || !applicationRuleValues(app).length) throw new Error(t('vpn.applicationMissing'));
      // Icons stay in the runtime catalogue, outside persistent routing configuration.
      const { iconDataUrl: _icon, ...identity } = app;
      const draft: Rule = { ...rule, id:rule?.id??crypto.randomUUID(),type:'processPathRegex',values:applicationRuleValues(identity),application:identity,
        enabled:rule?.enabled??true,action:values.action,targetServerId:values.action==='proxy'?values.targetServerId:undefined };
      await patchConfig(current => withUnifiedUserRules(current,rule?unifiedUserRules(current).map(r=>r.id===rule.id?draft:r):[draft,...unifiedUserRules(current)]));
      notifyActionSuccess('save'); return true;
    } catch (e) { notifyActionFailed('save', e); return false; }
  }}>
    <Form.Item name="application" label={t('vpn.chooseApplication')} tooltip={t('vpn.applicationScope')} rules={[{ required: true }]} validateStatus={error ? 'error' : undefined} help={error?.message}>
      <Select allowClear showSearch loading={loading} aria-label={t('vpn.chooseApplication')} options={[...apps,...(rule?.application&&!apps.some(a=>a.id===rule.application?.id)?[rule.application]:[])].map(app => ({ value: app.id, label: <ApplicationIdentity application={app} name={app.coverage === 'unsupported' ? `${app.name} · ${t('vpn.unsupportedApplication')}` : app.name} />, disabled: app.coverage === 'unsupported' }))} filterOption={(input, option) => { const app = apps.find(a => a.id === option?.value); return `${app?.name ?? ''} ${app?.path ?? ''}`.toLowerCase().includes(input.toLowerCase()); }} onChange={id => setSelected(apps.find(a => a.id === id))} />
    </Form.Item>
    {error ? <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void refresh()}>{t('common.actions.retry')}</Button> : null}
    {selected?.coverage === 'executable' ? <Alert type="warning" title={t('vpn.applicationPartial')} /> : null}
    <Form.Item name="action" label={t('common.vocab.destination')}><Select allowClear={false} aria-label={t('common.vocab.destination')} options={(['proxy', 'direct', 'block'] as const).map(value => ({ value, label: actionLabels(t)[value] }))} /></Form.Item>
    {action === 'proxy' ? <Form.Item name="targetServerId" label={t('vpn.target')} tooltip={t('vpn.applicationDefaultTarget')} rules={[{ validator: async (_, value) => { if (!nodes.some(n => n.id === (value || config?.selectedServerId))) throw new Error(t('vpn.noNodes')); } }]}><ServerSelect aria-label={t('vpn.target')} servers={nodes} subscriptions={config?.subscriptions} /></Form.Item> : null}
    <Alert type="info" title={t('vpn.applicationSetupImpact')} />
  </DrawerForm>;
}
