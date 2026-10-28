import { actionLabels, ruleTypeLabels } from '@/i18n/vpnLabels';
import i18n from '@/i18n';
import { DeleteOutlined, EditOutlined, GlobalOutlined } from '@ant-design/icons';
import { Button, Switch } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import {
  AtomicValue,
  InlineList,
  Popconfirm,
  ResponsiveActions,
  Stack,
  columnWidth,
} from '@/components/client';
import { ApplicationIdentity } from '@/components/vpn/ApplicationIdentity';
import { NodeIdentity } from '@/components/vpn/NodeIdentity';
import type { InstalledApplication, UserConfig, Rule } from '@shared/types';
export function buildRuleColumns(
  _t: TFunction,
  edit: (rule: Rule) => void,
  remove: (id: string) => Promise<void>,
  toggle: (rule: Rule, enabled: boolean) => void,
  applications: InstalledApplication[] = [],
  config?: UserConfig | null
): ColumnsType<Rule> {
  return [
    {
      key: 'values',
      title: i18n.t('vpn.values'),
      render: (_, rule) =>
        rule.applications?.length ? (
          <Stack direction="row" align="center" wrap gap="control">
            {rule.applications.map((app) => {
              const live = applications.find((a) => a.id === app.id) ?? app;
              return <ApplicationIdentity key={app.id} name={live.name} application={live} />;
            })}
          </Stack>
        ) : (
          <Stack direction="row" align="center" gap="control">
            <span className="ds-application-icon" aria-hidden>
              <GlobalOutlined />
            </span>
            <InlineList
              label={i18n.t('vpn.values')}
              renderItem={(item) => <AtomicValue text={item.text} />}
              items={rule.values.map((value) => ({ key: value, text: value }))}
            />
          </Stack>
        ),
    },
    {
      key: 'type',
      title: i18n.t('vpn.ruleType'),
      width: columnWidth.badge,
      render: (_, rule) =>
        rule.applications?.length
          ? i18n.t('common.vocab.applicationRules')
          : ruleTypeLabels(i18n.t)[rule.type],
    },
    {
      key: 'target',
      title: i18n.t('common.vocab.destination'),
      width: columnWidth.badge,
      render: (_, rule) => <AtomicValue text={actionLabels(i18n.t)[rule.action]} />,
    },
    {
      key: 'node',
      title: i18n.t('vpn.target'),
      width: columnWidth.name,
      render: (_, rule) => {
        const node =
          rule.action === 'proxy' && rule.targetServerId
            ? config?.servers.find((n) => n.id === rule.targetServerId)
            : undefined;
        return node ? (
          <NodeIdentity nodeId={node.id} name={node.name} />
        ) : (
          <AtomicValue text={rule.action === 'proxy' ? i18n.t('vpn.defaultNode') : '—'} />
        );
      },
    },
    {
      key: 'enabled',
      title: i18n.t('common.actions.enable'),
      width: columnWidth.badge,
      render: (_, rule) => (
        <Switch
          aria-label={i18n.t('common.actions.enable')}
          checked={rule.enabled}
          onChange={(enabled) => toggle(rule, enabled)}
        />
      ),
    },
    {
      key: 'action',
      title: i18n.t('common.vocab.operations'),
      width: columnWidth.actions(2),
      render: (_, rule) => (
        <ResponsiveActions justify="start">
          <Button icon={<EditOutlined aria-hidden />} onClick={() => edit(rule)}>
            {i18n.t('common.actions.edit')}
          </Button>
          <Popconfirm
            title={i18n.t('common.confirm.execute')}
            description={i18n.t('vpn.deleteImpact')}
            onConfirm={() => remove(rule.id)}
          >
            <Button icon={<DeleteOutlined aria-hidden />} color="danger" variant="text">
              {i18n.t('common.actions.delete')}
            </Button>
          </Popconfirm>
        </ResponsiveActions>
      ),
    },
  ];
}
