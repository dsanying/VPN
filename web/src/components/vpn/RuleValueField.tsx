import { Form, Input, type FormItemProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { validateRuleValue } from '@shared/rules';
import type { RuleType } from '@shared/types';
import type { TFunction } from 'i18next';
import { splitRuleValues } from './ruleValues';

const ruleValueHints = (t: TFunction) => ({
  domain: t('vpn.ruleValueHints.domain'),
  domainSuffix: t('vpn.ruleValueHints.domainSuffix'),
  domainKeyword: t('vpn.ruleValueHints.domainKeyword'),
  regex: t('vpn.ruleValueHints.regex'),
  ipCidr: t('vpn.ruleValueHints.ipCidr'),
  port: t('vpn.ruleValueHints.port'),
  processName: t('vpn.ruleValueHints.processName'),
  processPath: t('vpn.ruleValueHints.processPath'),
  sourceMac: t('vpn.ruleValueHints.sourceMac'),
  sourceHostname: t('vpn.ruleValueHints.sourceHostname'),
  geoTag: t('vpn.ruleValueHints.geoTag'),
  ruleSet: t('vpn.ruleValueHints.ruleSet'),
});

const formats: Record<RuleType, keyof ReturnType<typeof ruleValueHints>> = {
  domain: 'domain',
  domainSuffix: 'domainSuffix',
  domainKeyword: 'domainKeyword',
  domainRegex: 'regex',
  ipCidr: 'ipCidr',
  sourceIpCidr: 'ipCidr',
  port: 'port',
  sourcePort: 'port',
  processName: 'processName',
  processPath: 'processPath',
  processPathRegex: 'regex',
  sourceMac: 'sourceMac',
  sourceHostname: 'sourceHostname',
  geosite: 'geoTag',
  geoip: 'geoTag',
  ruleSet: 'ruleSet',
};

/** One input and validation contract for every rule condition, without a second draft state. */
export function RuleValueField({ type, name, typePath }: {
  type: RuleType;
  name: FormItemProps['name'];
  typePath: NonNullable<FormItemProps['name']>;
}) {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const hint = formats[type];
  return <Form.Item
    name={name}
    label={t('vpn.values')}
    tooltip={`${ruleValueHints(t)[hint]} ${t('vpn.onePerLine')}`}
    dependencies={[typePath]}
    validateFirst
    rules={[
      { required: true, transform: (value: string | undefined) => value?.trim() },
      { validator: async (_, text: string | undefined) => {
        const currentType = form.getFieldValue(typePath) as RuleType;
        if (splitRuleValues(text ?? '').some(value => !validateRuleValue(currentType, value))) {
          throw new Error(t('vpn.invalidRuleValue'));
        }
      } },
    ]}
  ><Input.TextArea allowClear autoSize={{ minRows: 2, maxRows: 6 }} /></Form.Item>;
}
