import { Alert, Card, Typography } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionEntry, ConnectionsSnapshot, InstalledApplication } from '@shared/types';
import { createConnectionFlowSelector } from '@shared/live-traffic';
import { SummaryStrip, ContentStack } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import { ConnectionGraph, type ConnectionSelection } from './ConnectionGraph';

export function ConnectionTopology({ snapshot, connections, applications, display, onSelect }: {
  snapshot?: ConnectionsSnapshot; connections: ConnectionEntry[]; applications: InstalledApplication[];
  display: (value: string) => string; onSelect: (value: ConnectionSelection) => void;
}) {
  const { t } = useTranslation();
  const running = useAppStore(s => s.connectionStatus?.proxyCore.running ?? false);
  const visible = connections;
  const selectFlows = useMemo(() => createConnectionFlowSelector(), []);
  const flows = useMemo(() => selectFlows(visible, applications), [selectFlows, visible, applications]);
  return <Card title={t('vpn.connectionTopology')} extra={<Typography.Text type="secondary">{t(running ? 'vpn.proxyTraffic' : 'vpn.deviceTraffic')}</Typography.Text>}><ContentStack>
    <SummaryStrip items={[{ key: 'total', label: t('common.vocab.connections'), value: visible.length }, { key: 'groups', label: t('common.vocab.groups'), value: new Set(flows.map(f => f.identity)).size }, { key: 'outbounds', label: t('common.vocab.outbound'), value: new Set(flows.map(f => f.outbound)).size }]} />
    {snapshot?.limited ? <Alert type="warning" title={t('vpn.connectionsLimited')} /> : null}
    {snapshot?.unavailable ? <Alert type="warning" title={t('vpn.deviceConnectionsUnavailable')} /> : null}
    {visible.length ? <ConnectionGraph flows={flows} applications={applications} display={display} label={t('vpn.connectionTopology')} onSelect={onSelect} /> : !snapshot?.connections.length ? <Typography.Text type="secondary">{t('vpn.noActiveConnections')}</Typography.Text> : null}
  </ContentStack></Card>;
}
