import { ENTERPRISE_NAMES } from '@shared/enterprise-vpn';
import { NodeAvailability } from '@/components/vpn/NodeAvailability';
import { NodeIdentity } from '@/components/vpn/NodeIdentity';
import { useTranslation } from 'react-i18next';
import { AppEmpty, HelpTip, MetadataTag, Stack } from '@/components/client';
import type { ServerConfig } from '@shared/types';
import { EntryLatencyCell, LatencyCell } from './LatencyCell';
import { NodeActions } from './NodeActions';
import './NodeList.css';

type NodeListProps = Omit<Parameters<typeof NodeActions>[0], 'node' | 'selected' | 'testing'> & {
  nodes: ServerConfig[];
  selected: string | null;
  testing: string[];
};

export function NodeList({ nodes, selected, testing, ...actions }: NodeListProps) {
  const { t } = useTranslation();
  if (!nodes.length) return <AppEmpty />;
  return (
    <ul className="vpn-node-list" aria-label={t('common.vocab.nodes')}>
      {nodes.map(node => (
        <li key={node.id} className="vpn-node-list__item" data-selected={selected === node.id}>
          <div className="vpn-node-list__identity">
            <NodeIdentity nodeId={node.id} name={node.name} className="vpn-node-list__name" />
            <Stack direction="row" wrap gap="control" align="center">
              <MetadataTag>{node.enterpriseSettings ? ENTERPRISE_NAMES[node.enterpriseSettings.client] : node.protocol.toUpperCase()}</MetadataTag><NodeAvailability nodeId={node.id}/>
            </Stack>
          </div>
          <dl className="vpn-node-list__metrics">
            <div>
              <dt><HelpTip title={t('vpn.entryHint')}>{t('vpn.entryLatency')}</HelpTip></dt>
              <dd><EntryLatencyCell node={node} /></dd>
            </div>
            <div>
              <dt><HelpTip title={t('vpn.proxyHint')}>{t('vpn.proxyLatency')}</HelpTip></dt>
              <dd><LatencyCell node={node} /></dd>
            </div>
          </dl>
          <div className="vpn-node-list__actions">
            <NodeActions node={node} selected={selected === node.id} testing={testing.includes(node.id)} {...actions} />
          </div>
        </li>
      ))}
    </ul>
  );
}
