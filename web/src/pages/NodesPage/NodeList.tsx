import { CheckCircleFilled } from '@ant-design/icons';
import { ENTERPRISE_NAMES } from '@shared/enterprise-vpn';
import { NodeAvailability } from '@/components/vpn/NodeAvailability';
import { NodeIdentity } from '@/components/vpn/NodeIdentity';
import { useTranslation } from 'react-i18next';
import { AppEmpty, MetadataTag } from '@/components/client';
import type { ServerConfig } from '@shared/types';
import { EntryLatencyCell, LatencyCell } from './LatencyCell';
import { NodeActions } from './NodeActions';
import './NodeList.css';

type NodeListProps = Omit<Parameters<typeof NodeActions>[0], 'node' | 'selected' | 'testing'> & {
  nodes: ServerConfig[];
  selected: string | null;
  testing: string[];
};

/** 节点紧凑卡片网格：点卡片即启用（主操作不占版面），悬停浮出测速/更多。 */
export function NodeList({ nodes, selected, testing, ...actions }: NodeListProps) {
  const { t } = useTranslation();
  if (!nodes.length) return <AppEmpty />;
  return (
    <ul className="vpn-node-list" aria-label={t('common.vocab.nodes')}>
      {nodes.map(node => {
        const isSelected = selected === node.id;
        return (
          <li key={node.id} className="vpn-node-list__item" data-selected={isSelected}>
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
                <NodeIdentity nodeId={node.id} name={node.name} className="vpn-node-list__name" />
                <MetadataTag>{node.enterpriseSettings ? ENTERPRISE_NAMES[node.enterpriseSettings.client] : node.protocol.toUpperCase()}</MetadataTag>
              </span>
              <span className="vpn-node-list__metrics">
                <span className="vpn-node-list__lat" data-slot="proxy"><LatencyCell node={node} variant="card" /></span>
                <span className="vpn-node-list__entry" data-slot="entry" title={t('vpn.entryLatency')}>
                  <EntryLatencyCell node={node} />
                </span>
                <NodeAvailability nodeId={node.id} />
              </span>
            </button>
            <div className="vpn-node-list__ops">
              <NodeActions node={node} selected={isSelected} testing={testing.includes(node.id)} variant="card" {...actions} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
