import './ConnectionsPage.css';
import { NodeRoute } from '@/components/vpn/NodeRoute';
import { useCallback, useMemo, useState } from 'react';
import { Form } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  AppPage,
  PageStack,
  Table,
  TablePanel,
  SearchInput,
  DEFAULT_PAGE_SIZE,
  buildTablePagination,
  QueryForm,
  FilterSelect,
} from '@/components/client';
import { useInstalledApplications } from '@/hooks/use-installed-applications';
import { useStatsTopic } from '@/hooks/use-stats-topic';
import { useAppStore } from '@/store/app-store';
import type { ConnectionsSnapshot } from '@shared/types';
import {
  connectionApplication,
  connectionDestination,
  connectionOutbound,
  filterConnections,
  UNKNOWN_APPLICATION,
  UNKNOWN_DESTINATION,
  UNKNOWN_OUTBOUND,
} from '@shared/live-traffic';
import { ConnectionTopology } from './ConnectionTopology';
import type { ConnectionSelection } from './ConnectionGraph';
import { ServiceAvailability } from './ServiceAvailability';
import { buildConnectionColumns } from './columns';

export default function ConnectionsPage() {
  const { t } = useTranslation();
  const { applications: installedApplications } = useInstalledApplications();
  const running = useAppStore((s) => s.connectionStatus?.proxyCore.running ?? false);
  const [snapshot, setSnapshot] = useState<ConnectionsSnapshot>();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [selectedApplications, setSelectedApplications] = useState<string[]>([]);
  const [selectedOutbounds, setSelectedOutbounds] = useState<string[]>([]);
  const [network, setNetwork] = useState<string[]>([]);
  const onSelect = useCallback((value: ConnectionSelection) => {
    setSelectedApplications(value.application ? [value.application] : []);
    setSelectedOutbounds(value.outbound ? [value.outbound] : []);
    setPage(1);
  }, []);
  useStatsTopic<ConnectionsSnapshot>('detail', setSnapshot);
  const current =
    snapshot && (running ? snapshot.source !== 'device' : snapshot.source === 'device')
      ? snapshot
      : undefined;
  const all = useMemo(() => current?.connections ?? [], [current]);
  const applications = useMemo(() => {
    const merged = new Map((current?.applications ?? []).map((app) => [app.path, app]));
    for (const app of installedApplications)
      merged.set(app.path, {
        ...app,
        iconDataUrl: app.iconDataUrl ?? merged.get(app.path)?.iconDataUrl,
      });
    return [...merged.values()];
  }, [current?.applications, installedApplications]);
  const display = useCallback(
    (value: string) =>
      value === 'direct'
        ? t('common.vocab.direct')
        : value === 'block' || value === 'reject'
          ? t('common.vocab.block')
          : value === 'system-network'
            ? t('common.vocab.systemNetwork')
            : value === UNKNOWN_APPLICATION
              ? t('vpn.unidentifiedApplication')
              : value === UNKNOWN_DESTINATION
                ? t('vpn.unidentifiedDestination')
                : value === UNKNOWN_OUTBOUND
                  ? t('vpn.unidentifiedOutbound')
                  : value,
    [t]
  );
  const searched = useMemo(
    () => filterConnections(all, search, applications, display),
    [all, search, applications, display]
  );
  const filtered = useMemo(
    () =>
      searched.filter(
        (c) =>
          (!selectedApplications.length ||
            selectedApplications.includes(connectionApplication(c, applications).identity)) &&
          (!selectedOutbounds.length || selectedOutbounds.includes(connectionOutbound(c))) &&
          (!network.length || network.includes(c.metadata?.network?.toLowerCase() ?? ''))
      ),
    [searched, selectedApplications, selectedOutbounds, network, applications]
  );
  const applicationOptions = useMemo(
    () => [
      ...new Map(
        all.map((c) => {
          const app = connectionApplication(c, applications);
          return [app.identity, { value: app.identity, label: display(app.name) }] as const;
        })
      ).values(),
    ],
    [all, applications, display]
  );
  const outboundOptions = useMemo(
    () =>
      [...new Set(all.map(connectionOutbound))].map((value) => ({ value, label: display(value) })),
    [all, display]
  );
  const networks = useMemo(
    () =>
      [
        ...new Set(
          all.flatMap((c) => (c.metadata?.network ? [c.metadata.network.toLowerCase()] : []))
        ),
      ].map((value) => ({ value, label: value.toUpperCase() })),
    [all]
  );
  // Preserve a selected graph identity while its last active connection disappears.
  const withSelected = (options: { value: string; label: string }[], values: string[]) => [
    ...options,
    ...values
      .filter((value) => !options.some((option) => option.value === value))
      .map((value) => ({ value, label: display(value) })),
  ];
  return (
    <AppPage showBreadcrumb={false}>
      <PageStack>
        <ServiceAvailability />
        <ConnectionTopology
          snapshot={current}
          connections={searched}
          applications={applications}
          display={display}
          onSelect={onSelect}
        />
        <TablePanel>
          <QueryForm mode="local">
            <Form.Item label={t('common.vocab.search')} data-filter-purpose="keyword">
              <SearchInput
                allowClear
                aria-label={t('common.vocab.connections')}
                hint={t('vpn.connectionSearchHint')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </Form.Item>
            <Form.Item
              label={t('common.vocab.application')}
              data-filter-column="./columns#application"
            >
              <FilterSelect
                kind="enum"
                className="vpn-connection-filter-control"
                aria-label={t('common.vocab.application')}
                showSearch
                options={withSelected(applicationOptions, selectedApplications)}
                optionFilterProp="label"
                value={selectedApplications}
                onChange={(value) => {
                  setSelectedApplications(value);
                  setPage(1);
                }}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.outbound')} data-filter-column="./columns#outbound">
              <FilterSelect
                kind="enum"
                className="vpn-connection-filter-control"
                aria-label={t('common.vocab.outbound')}
                showSearch
                optionRender={(option) => (
                  <NodeRoute values={[String(option.value)]} display={display} />
                )}
                labelRender={(option) => (
                  <NodeRoute values={[String(option.value)]} display={display} />
                )}
                options={withSelected(outboundOptions, selectedOutbounds)}
                optionFilterProp="label"
                value={selectedOutbounds}
                onChange={(value) => {
                  setSelectedOutbounds(value);
                  setPage(1);
                }}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.protocol')} data-filter-column="./columns#network">
              <FilterSelect
                kind="enum"
                className="vpn-connection-filter-control"
                aria-label={t('common.vocab.protocol')}
                options={networks}
                value={network}
                onChange={(value) => {
                  setNetwork(value);
                  setPage(1);
                }}
              />
            </Form.Item>
          </QueryForm>
          <Table
            rowKey="id"
            dataSource={filtered}
            orderBy={(row) => {const value=connectionDestination(row);return value===UNKNOWN_DESTINATION?'':value;}}
            columns={buildConnectionColumns(t, applications)}
            pagination={buildTablePagination({
              current: Math.min(page, Math.max(1, Math.ceil(filtered.length / size))),
              pageSize: size,
              total: filtered.length,
              onChange: (p, s) => {
                setPage(p);
                setSize(s);
              },
            })}
          />
        </TablePanel>
      </PageStack>
    </AppPage>
  );
}
