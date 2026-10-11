import { ServerSelect } from '@/components/vpn/ServerSelect';
import { isSubscriptionNotice } from '@shared/subscription-notice';
import { isServerComplete } from '@shared/server-completeness';
import { actionLabels } from '@/i18n/vpnLabels';
import { Button, Select } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { ColumnsType } from 'antd/es/table';
import { Popconfirm, ResponsiveActions, columnWidth } from '@/components/client';
import type { UserConfig, AppRule } from '@shared/types';
import { ApplicationIdentity } from '@/components/vpn/ApplicationIdentity';
import type { InstalledApplication } from '@shared/types';
import i18n from '@/i18n';
export type PresetRow = { id: string; name: string; application?: InstalledApplication };
export function buildAppsColumns(_t: TFunction, config: UserConfig | null, update: (id: string, patch: Partial<AppRule>) => Promise<void>, remove: (id: string) => Promise<void>): ColumnsType<PresetRow> {
  return [
    { key: 'name', title: i18n.t('common.vocab.name'), render: (_, row) => <ApplicationIdentity name={row.name} application={row.application} /> },
    { key: 'target', title: i18n.t('common.vocab.destination'), width: columnWidth.name, render: (_, row) => {
      const rule = config?.appRules?.find(r => r.appId === row.id);
      return <Select<'follow' | AppRule['action']> allowClear={false} aria-label={`${row.name} ${i18n.t('common.vocab.destination')}`} value={config?.appRoutingEnabled === true && rule?.enabled ? rule.action : 'follow'} options={[{ value: 'follow', label: i18n.t('vpn.followRouting') }, ...(['proxy', 'direct', 'block'] as const).map(value => ({ value, label: actionLabels(i18n.t)[value] }))]} onChange={action => void update(row.id, action === 'follow' ? { enabled: false } : { enabled: true, action })} />;
    } },
    { key: 'node', title: i18n.t('vpn.target'), width: columnWidth.name, render: (_, row) => {
      const rule = config?.appRules?.find(r => r.appId === row.id);
      return <ServerSelect aria-label={`${row.name} ${i18n.t('vpn.target')}`} disabled={config?.appRoutingEnabled !== true || !rule?.enabled || rule.action !== 'proxy'} value={rule?.targetServerId} servers={config?.servers.filter(n => !isSubscriptionNotice(n.name) && isServerComplete(n)) ?? []} subscriptions={config?.subscriptions} onChange={targetServerId => void update(row.id, { targetServerId })} />;
    } },
    { key: 'action', title: i18n.t('common.vocab.operations'), width: columnWidth.actions(1), render: (_, row) => <ResponsiveActions justify="start">
      <Popconfirm title={i18n.t('common.confirm.execute')} onConfirm={() => remove(row.id)}><Button icon={<DeleteOutlined aria-hidden />} color="danger" variant="text">{i18n.t('common.actions.delete')}</Button></Popconfirm>
    </ResponsiveActions> },
  ];
}
