import { indexedServer } from './nodeDisplayCache';
import { AtomicValue } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import { nodeDisplayIdentity, nodeGroupName } from '@shared/node-identity';
import { useTranslation } from 'react-i18next';
import { NodeRegionIcon } from './NodeRegionIcon';
import { useNodeRegion } from './useNodeRegion';
import './NodeIdentity.css';

/** Display the group before the measured region and original name; never change routing identity. */
export function NodeIdentity({
  nodeId,
  name,
  className,
  groupName,
}: {
  nodeId: string;
  name: string;
  className?: string;
  /** An empty group suppresses the prefix when the parent group is already visible. */
  groupName?: string;
}) {
  const { t } = useTranslation();
  const node = useAppStore(state => indexedServer(state.config?.servers, nodeId));
  const subscriptions = useAppStore(state => state.config?.subscriptions);
  const { code } = useNodeRegion(nodeId);
  const prefix = groupName ?? (node ? nodeGroupName(node, subscriptions, {
    manual: t('common.vocab.manualNodes'), mesh: t('common.vocab.meshNetworking'),
  }) : undefined);
  const identity = nodeDisplayIdentity(name, code, prefix);
  return (
    <AtomicValue text={identity.text} className={['ds-node-identity', className].filter(Boolean).join(' ')}>
      {identity.groupPrefix && <span>{identity.groupPrefix}</span>}
      <NodeRegionIcon nodeId={nodeId} />
      <span>{identity.name}</span>
    </AtomicValue>
  );
}
