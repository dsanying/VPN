import { CheckCircleFilled } from '@ant-design/icons';
import { ENTERPRISE_NAMES } from '@shared/enterprise-vpn';
import { nodeGroupName } from '@shared/node-identity';
import { NodeAvailability } from '@/components/vpn/NodeAvailability';
import { NodeRegionIcon } from '@/components/vpn/NodeRegionIcon';
import { indexedServer } from '@/components/vpn/nodeDisplayCache';
import { useTranslation } from 'react-i18next';
import { AppEmpty, MetadataTag } from '@/components/client';
import { entryLatencySummary } from '@/domain/lib/entry-latency';
import { useAppStore } from '@/store/app-store';
import type { ServerConfig } from '@shared/types';
import { LatencyCell } from './LatencyCell';
import { NodeActions } from './NodeActions';
import './NodeList.css';

type NodeActionProps = Omit<Parameters<typeof NodeActions>[0], 'node' | 'selected' | 'testing'>;

type NodeListProps = NodeActionProps & {
  nodes: ServerConfig[];
  selected: string | null;
  testing: string[];
  /** 筛选单一来源时来源名已由页面上下文可见，卡片不再重复来源标签。 */
  suppressGroup?: boolean;
};

/** 节点紧凑卡片：名字为主位可换行，来源/协议降级为标签行；卡片行高统一，代理延迟为主指标。 */
export function NodeList({ nodes, selected, testing, suppressGroup, ...actions }: NodeListProps) {
  const { t } = useTranslation();
  if (!nodes.length) return <AppEmpty />;
  return (
    <ul className="vpn-node-list" aria-label={t('common.vocab.nodes')}>
      {nodes.map(node => (
        <NodeCard
          key={node.id}
          node={node}
          isSelected={selected === node.id}
          testing={testing}
          suppressGroup={suppressGroup}
          {...actions}
        />
      ))}
    </ul>
  );
}

function NodeCard({
  node,
  isSelected,
  testing,
  suppressGroup,
  ...actions
}: NodeActionProps & { node: ServerConfig; isSelected: boolean; testing: string[]; suppressGroup?: boolean }) {
  const { t } = useTranslation();
  const nodeConfig = useAppStore(state => indexedServer(state.config?.servers, node.id));
  const subscriptions = useAppStore(state => state.config?.subscriptions);
  const entry = useAppStore(state => state.probeDetails[node.id]?.entry);
  // 来源组名降级为小标签；与共享 NodeIdentity 同源计算，不改变路由身份。
  const group = suppressGroup || !nodeConfig
    ? undefined
    : nodeGroupName(nodeConfig, subscriptions, {
        manual: t('common.vocab.manualNodes'),
        mesh: t('common.vocab.meshNetworking'),
      });
  return (
    <li className="vpn-node-list__item" data-selected={isSelected}>
      <button
        type="button"
        className="vpn-node-list__card"
        aria-pressed={isSelected}
        title={node.name}
        onClick={() => { if (!isSelected) void actions.select(node); }}
      >
        <span className="vpn-node-list__identity">
          {isSelected ? (
            <CheckCircleFilled className="vpn-node-list__current" aria-label={t('common.vocab.current')} />
          ) : null}
          <NodeRegionIcon nodeId={node.id} />
          <span className="vpn-node-list__name">{node.name}</span>
        </span>
        <span className="vpn-node-list__tags">
          {group && <MetadataTag className="vpn-node-list__source">{group}</MetadataTag>}
          <MetadataTag>{node.enterpriseSettings ? ENTERPRISE_NAMES[node.enterpriseSettings.client] : node.protocol.toUpperCase()}</MetadataTag>
        </span>
        <span className="vpn-node-list__metrics">
          {/* 代理延迟是主指标常驻；入口探测降级为同一格的 tooltip，不再两个延时并排。 */}
          <span
            className="vpn-node-list__lat"
            data-slot="proxy"
            title={entry ? `${t('vpn.entryLatency')} ${entryLatencySummary(entry, t)}` : undefined}
          >
            <LatencyCell node={node} variant="card" />
          </span>
          <NodeAvailability nodeId={node.id} />
        </span>
      </button>
      <div className="vpn-node-list__ops">
        <NodeActions node={node} selected={isSelected} testing={testing.includes(node.id)} variant="card" {...actions} />
      </div>
    </li>
  );
}
