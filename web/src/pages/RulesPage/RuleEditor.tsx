import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { Button, Form, Input, Select, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { DrawerForm, FormGrid, Popconfirm } from '@/components/client';
import { ServerSelect } from '@/components/vpn/ServerSelect';
import { DesktopSection } from '@/components/vpn/DesktopSection';
import { RuleValueField } from '@/components/vpn/RuleValueField';
import { splitRuleValues } from '@/components/vpn/ruleValues';
import { actionLabels, ruleTypeLabels } from '@/i18n/vpnLabels';
import { useAppStore } from '@/store/app-store';
import { patchConfig } from '@/store/config-mutations';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { ruleConditions } from '@shared/rules';
import { unifiedUserRules, withUnifiedUserRules } from '@shared/unified-rules';
import type { Rule, RuleType } from '@shared/types';

const TYPES: RuleType[] = ['domain', 'domainSuffix', 'domainKeyword', 'domainRegex', 'ipCidr', 'sourceIpCidr', 'port', 'sourcePort', 'processName', 'processPath', 'sourceMac', 'sourceHostname'];
type RuleForm = Pick<Rule, 'action' | 'targetServerId' | 'remarks' | 'enabled' | 'combineMode' | 'bypassFakeIP'> & {
  matchConditions: { type: RuleType; text: string }[];
};

export function RuleEditor({ rule, onClose }: { rule?: Rule; onClose: () => void }) {
  const { t } = useTranslation();
  const config = useAppStore(state => state.config);
  const [form] = Form.useForm<RuleForm>();
  const action = Form.useWatch('action', form) ?? rule?.action ?? 'proxy';
  const watchedConditions = Form.useWatch('matchConditions', form) as RuleForm['matchConditions'] | undefined;
  const initialConditions = rule ? ruleConditions(rule) : [{ type: 'domainSuffix' as const, values: [] }];
  const types = [...new Set([...TYPES, ...initialConditions.map(condition => condition.type)])];
  const typeOptions = types.map(value => ({ value, label: ruleTypeLabels(t)[value] }));
  return <DrawerForm<RuleForm> form={form} open title={t('common.vocab.rules')} onOpenChange={open => { if (!open) onClose(); }} initialValues={{
    enabled: rule?.enabled ?? true,
    action: rule?.action ?? 'proxy',
    targetServerId: rule?.targetServerId,
    remarks: rule?.remarks,
    bypassFakeIP: rule?.bypassFakeIP ?? false,
    combineMode: rule?.combineMode ?? 'or',
    matchConditions: initialConditions.map(condition => ({ type: condition.type, text: condition.values.join('\n') })),
  }} onFinish={async ({ matchConditions, ...values }) => {
    try {
      const conditions = matchConditions.map(condition => ({ type: condition.type, values: splitRuleValues(condition.text) }));
      const draft: Rule = {
        ...structuredClone(rule ?? {}), ...values,
        id: rule?.id ?? crypto.randomUUID(),
        type: conditions[0].type, values: conditions[0].values,
        conditions: conditions.length > 1 ? conditions : undefined,
        combineMode: conditions.length > 1 ? values.combineMode ?? 'or' : undefined,
        targetServerId: values.action === 'proxy' ? values.targetServerId : undefined,
      };
      await patchConfig(current => withUnifiedUserRules(current, rule ? unifiedUserRules(current).map(item => item.id === rule.id ? draft : item) : [draft, ...unifiedUserRules(current)]));
      notifyActionSuccess('save'); return true;
    } catch (error) { notifyActionFailed('save', error); return false; }
  }}>
    <DesktopSection title={t('common.vocab.conditions')}>
      {(watchedConditions?.length ?? initialConditions.length) > 1 ? <Form.Item label={t('vpn.combine')} name="combineMode"><Select allowClear={false} options={[{ value: 'or', label: t('vpn.or') }, { value: 'and', label: t('vpn.and') }]} /></Form.Item> : null}
      <Form.List name="matchConditions">{(fields, { add, remove }) => <>
        {fields.map(field => <div key={field.key}>
          <Form.Item name={[field.name, 'type']} label={t('vpn.ruleType')} rules={[{ required: true }]}><Select allowClear={false} options={typeOptions} /></Form.Item>
          <RuleValueField name={[field.name, 'text']} typePath={['matchConditions', field.name, 'type']} type={watchedConditions?.[field.name]?.type ?? initialConditions[field.name]?.type ?? 'domainSuffix'} />
          {fields.length > 1 ? <Popconfirm title={t('common.confirm.execute')} onConfirm={() => remove(field.name)}><Button icon={<DeleteOutlined aria-hidden />} color="danger" variant="text">{t('common.actions.delete')}</Button></Popconfirm> : null}
        </div>)}
        <Button icon={<PlusOutlined aria-hidden />} onClick={() => add({ type: 'domainSuffix', text: '' })}>{t('common.actions.create')}</Button>
      </>}</Form.List>
    </DesktopSection>
    <Form.Item label={t('common.vocab.destination')} name="action"><Select allowClear={false} options={(['proxy', 'direct', 'block'] as const).map(value => ({ value, label: actionLabels(t)[value] }))} /></Form.Item>
    {action === 'proxy' ? <Form.Item label={t('vpn.target')} name="targetServerId"><ServerSelect aria-label={t('vpn.target')} servers={config?.servers ?? []} subscriptions={config?.subscriptions} /></Form.Item> : null}
    <Form.Item label={t('vpn.remarks')} name="remarks"><Input allowClear /></Form.Item>
    <FormGrid columns={2} field="short">
      <Form.Item label={t('common.actions.enable')} name="enabled" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item label={t('vpn.bypassFakeIp')} name="bypassFakeIP" valuePropName="checked"><Switch /></Form.Item>
    </FormGrid>
  </DrawerForm>;
}
