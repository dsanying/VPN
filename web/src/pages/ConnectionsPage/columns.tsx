import { NodeRoute } from '@/components/vpn/NodeRoute';
import { formatDataSize } from '@shared/network-units';
import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import { AtomicValue, columnWidth } from '@/components/client';
import type { ConnectionEntry, InstalledApplication } from '@shared/types';
import { ApplicationIdentity } from '@/components/vpn/ApplicationIdentity';
import {
  connectionApplication,
  connectionDestination,
  connectionOutbound,
  UNKNOWN_APPLICATION,
  UNKNOWN_DESTINATION,
  UNKNOWN_OUTBOUND,
} from '@shared/live-traffic';
export function buildConnectionColumns(
  t: TFunction,
  applications: InstalledApplication[]
): ColumnsType<ConnectionEntry> {
  return [
    {
      key: 'destination',
      title: t('common.vocab.destination2'),
      render: (_, row) => {
        const destination = connectionDestination(row);
        return (
          <AtomicValue
            text={`${destination === UNKNOWN_DESTINATION ? t('vpn.unidentifiedDestination') : destination}${row.metadata?.destinationPort ? `:${row.metadata.destinationPort}` : ''}`}
          />
        );
      },
    },
    {
      key: 'application',
      title: t('common.vocab.application'),
      width: columnWidth.name,
      render: (_, row) => {
        const identity = connectionApplication(row, applications);
        return (
          <ApplicationIdentity
            name={
              identity.name === UNKNOWN_APPLICATION
                ? t('vpn.unidentifiedApplication')
                : identity.name
            }
            application={applications.find((a) => a.path === identity.identity)}
          />
        );
      },
    },
    {
      key: 'source',
      title: t('common.vocab.source'),
      width: columnWidth.code,
      render: (_, row) => (
        <AtomicValue
          text={
            row.metadata?.sourceIP
              ? `${row.metadata.sourceIP}${row.metadata.sourcePort ? `:${row.metadata.sourcePort}` : ''}`
              : '—'
          }
        />
      ),
    },
    {
      key: 'process',
      title: t('common.vocab.processPath'),
      width: columnWidth.code,
      render: (_, row) => <AtomicValue text={row.metadata?.processPath || '—'} />,
    },
    {
      key: 'outbound',
      title: t('common.vocab.outbound'),
      width: columnWidth.name,
      render: (_, row) => {
        const chains = row.chains ?? [];
        const display = (value: string) =>
          value === 'direct'
            ? t('common.vocab.direct')
            : value === 'system-network'
              ? t('common.vocab.systemNetwork')
              : value === 'block' || value === 'reject'
                ? t('common.vocab.block')
                : value === UNKNOWN_OUTBOUND
                  ? t('vpn.unidentifiedOutbound')
                  : value;
        const values = row.outbound && !chains.includes(row.outbound)
          ? [row.outbound, ...chains]
          : chains;
        return (
          <NodeRoute values={values.length ? values : [connectionOutbound(row)]} display={display} />
        );
      },
    },
    {
      key: 'rule',
      title: t('common.vocab.rules'),
      width: columnWidth.name,
      render: (_, row) => <AtomicValue text={row.rule || '—'} />,
    },
    {
      key: 'network',
      title: t('common.vocab.protocol'),
      width: columnWidth.badge,
      render: (_, row) => <AtomicValue text={row.metadata?.network?.toUpperCase() || '—'} />,
    },
    {
      key: 'traffic',
      title: t('common.vocab.traffic'),
      width: columnWidth.code,
      render: (_, row) => (
        <AtomicValue text={`↓ ${formatDataSize(row.download)} / ↑ ${formatDataSize(row.upload)}`} />
      ),
    },
  ];
}
