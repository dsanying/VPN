import { Cascader } from 'antd';
import { NodeAvailability } from './NodeAvailability';
import { Stack } from '@/components/client';
import { NodeIdentity } from './NodeIdentity';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { groupServersBySubscription } from '@shared/server-grouping';
import type { ServerConfig, SubscriptionConfig } from '@shared/types';

type ServerSelectProps = {
  servers: ServerConfig[];
  subscriptions?: SubscriptionConfig[];
  value?: string | null;
  onChange?: (id: string | undefined) => void;
  disabled?: boolean;
  'aria-label'?: string;
};

/** 展示分组路径，配置仍保存节点 ID；父组不能作为目标节点提交。 */
export function ServerSelect({ servers, subscriptions, value, onChange, disabled, 'aria-label': label }: ServerSelectProps) {
  const { t } = useTranslation();
  const options = useMemo(() => groupServersBySubscription(servers, subscriptions).map(group => ({
    value: group.isManual ? 'manual' : group.isMesh ? 'mesh' : `subscription:${group.id}`,
    label: group.isManual ? t('common.vocab.manualNodes') : group.isMesh ? t('common.vocab.meshNetworking') : group.name,
    children: group.servers.map(server => ({ value: server.id, label: server.name })),
  })), [servers, subscriptions, t]);
  const group = options.find(option => option.children.some(server => server.value === value));
  const groupValue = group?.value;
  // rc-cascader uses the selected path's identity to reset its active column and scroll.
  // Keep it stable during unrelated config/status refreshes, even if callers filter servers again.
  const selectedPath = useMemo(() => groupValue && value ? [groupValue, value] : undefined, [groupValue, value]);
  return <Cascader
    aria-label={label}
    disabled={disabled}
    allowClear
    options={options}
    value={selectedPath}
    expandTrigger="click"
    displayRender={(labels, selected) => selected?.length === 2 ? <Stack direction="row" gap="control" align="center"><NodeIdentity nodeId={String(selected[1].value)} name={String(labels[1])} groupName={String(labels[0])}/><NodeAvailability nodeId={String(selected[1].value)}/></Stack> : labels.join(' / ')}
    optionRender={option => option.children || typeof option.label !== 'string' ? option.label : <Stack direction="row" gap="control" align="center"><NodeIdentity nodeId={String(option.value)} name={option.label} groupName={options.find(group => group.children.some(node => node.value === option.value))?.label}/><NodeAvailability nodeId={String(option.value)}/></Stack>}
    styles={{ popup: { list: { overscrollBehavior: 'contain' } } }}
    showSearch={{ limit: Math.max(1, servers.length), render: (_input, path) => <Stack direction="row" gap="control" align="center"><NodeIdentity nodeId={String(path[path.length - 1].value)} name={String(path[path.length - 1].label)} groupName={String(path[0].label)}/><NodeAvailability nodeId={String(path[path.length - 1].value)}/></Stack>, filter: (input, path) => path.some(option => String(option.label).toLocaleLowerCase().includes(input.toLocaleLowerCase())) }}
    onChange={path => onChange?.(path?.length === 2 ? String(path[1]) : undefined)}
  />;
}
