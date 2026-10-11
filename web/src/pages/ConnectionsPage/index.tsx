import './ConnectionsPage.css';
import { ReloadOutlined } from '@ant-design/icons';
import { NodeRoute } from '@/components/vpn/NodeRoute';
import { useCallback, useMemo, useState } from 'react';
import { Button, Flex, Form, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  AppPage,
  PageStack,
  Table,
  TablePanel,
  SearchInput,
  DEFAULT_PAGE_SIZE,
  buildTablePagination,
} from '@/components/client';
import { useInstalledApplications } from '@/hooks/use-installed-applications';
import { useStatsTopic } from '@/hooks/use-stats-topic';
import { useAppStore } from '@/store/app-store';
import type { ConnectionsSnapshot } from '@shared/types';
import {
  connectionApplication,
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
  const [selection, setSelection] = useState<ConnectionSelection>({});
  const [network, setNetwork] = useState<string>();
  const onSelect = useCallback((value: ConnectionSelection) => {
    setSelection(value);
    setPage(1);
  }, []);
  useStatsTopic<ConnectionsSnapshot>('detail', setSnapshot);
  const current =
    snapshot && (running ? snapshot.source !== 'device' : snapshot.source === 'device')
      ? snapshot
      : undefined;
  const all = useMemo(() => current?.connections ?? [], [current]);
  const applications = useMemo(() => {
    const merged = new Map((current?.applications ?? []).map(app => [app.path, app]));
    for (const app of installedApplications) merged.set(app.path, { ...app, iconDataUrl: app.iconDataUrl ?? merged.get(app.path)?.iconDataUrl });
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
          (!selection.application ||
            connectionApplication(c, applications).identity === selection.application) &&
          (!selection.outbound || connectionOutbound(c) === selection.outbound) &&
          (!network || c.metadata?.network?.toLowerCase() === network)
      ),
    [searched, selection, network, applications]
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
  const withSelected = (options: { value: string; label: string }[], value?: string) =>
    value && !options.some((o) => o.value === value)
      ? [...options, { value, label: display(value) }]
      : options;
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
          <Form layout="inline" className="vpn-connection-filters">
            <Flex wrap gap="small">
              <Form.Item label={t('common.vocab.search')}>
                <SearchInput
                  aria-label={t('common.vocab.connections')}
                  hint={t('vpn.connectionSearchHint')}
                  allowClear
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Form.Item>
              <Form.Item label={t('common.vocab.application')}>
                <Select
                  className="vpn-connection-filter-control"
                  aria-label={t('common.vocab.application')}
                  showSearch
                  allowClear
                  options={withSelected(applicationOptions, selection.application)}
                  optionFilterProp="label"
                  value={selection.application}
                  onChange={(application) => onSelect({ ...selection, application })}
                />
              </Form.Item>
              <Form.Item label={t('common.vocab.outbound')}>
                <Select
                  className="vpn-connection-filter-control"
                  aria-label={t('common.vocab.outbound')}
                  showSearch
                  allowClear
                  optionRender={(option) => (
                    <NodeRoute values={[String(option.value)]} display={display} />
                  )}
                  labelRender={(option) => (
                    <NodeRoute values={[String(option.value)]} display={display} />
                  )}
                  options={withSelected(outboundOptions, selection.outbound)}
                  optionFilterProp="label"
                  value={selection.outbound}
                  onChange={(outbound) => onSelect({ ...selection, outbound })}
                />
              </Form.Item>
              <Form.Item label={t('common.vocab.protocol')}>
                <Select
                  className="vpn-connection-filter-control"
                  aria-label={t('common.vocab.protocol')}
                  allowClear
                  options={networks}
                  value={network}
                  onChange={(value) => {
                    setNetwork(value);
                    setPage(1);
                  }}
                />
              </Form.Item>
              <Button
                icon={<ReloadOutlined aria-hidden />}
                onClick={() => {
                  setSearch('');
                  setNetwork(undefined);
                  onSelect({});
                }}
              >
                {t('common.actions.reset')}
              </Button>
            </Flex>
          </Form>
          <Table
            rowKey="id"
            dataSource={filtered}
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
