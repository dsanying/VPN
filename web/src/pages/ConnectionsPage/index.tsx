import './ConnectionsPage.css';
import { NodeRoute } from '@/components/vpn/NodeRoute';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { useStable } from '@/hooks/use-stable';
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
  const graphSelection = useMemo<ConnectionSelection>(
    () => ({ application: selectedApplications[0], outbound: selectedOutbounds[0] }),
    [selectedApplications, selectedOutbounds]
  );
  // 实时帧交互暂停：焦点在筛选表单内（搜索输入 / 下拉选择）时挂起帧应用——
  // 输入过程页面不再逐秒重渲染，离开表单一次性补上最新帧（heldFrame 只留最新，
  // 不积压）。不暂停时行为与原来完全一致：每秒一帧。
  const pausedRef = useRef(false);
  const heldFrameRef = useRef<ConnectionsSnapshot | undefined>(undefined);
  useStatsTopic<ConnectionsSnapshot>('detail', (frame) => {
    if (pausedRef.current) heldFrameRef.current = frame;
    else setSnapshot(frame);
  });
  const current =
    snapshot && (running ? snapshot.source !== 'device' : snapshot.source === 'device')
      ? snapshot
      : undefined;
  const all = useMemo(() => current?.connections ?? [], [current]);
  const mergedApplications = useMemo(() => {
    const merged = new Map((current?.applications ?? []).map((app) => [app.path, app]));
    for (const app of installedApplications)
      merged.set(app.path, {
        ...app,
        iconDataUrl: app.iconDataUrl ?? merged.get(app.path)?.iconDataUrl,
      });
    return [...merged.values()];
  }, [current?.applications, installedApplications]);
  // 签名 = 路径 + 名称 + 图标数据长度（图标只在加载完成时出现一次，长度足以区分）。
  // 合并结果每帧重建但内容几乎不变，锁引用让下游列定义 / 筛选选项 / 图标组件不随帧抖动。
  const applicationSig = useMemo(
    () =>
      mergedApplications
        .map((app) => `${app.path}\u0000${app.name}\u0000${app.iconDataUrl?.length ?? -1}`)
        .join('\u0001'),
    [mergedApplications]
  );
  const applications = useStable(mergedApplications, applicationSig);
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
  // Preserve a selected graph identity while its last active connection disappears.
  const withSelected = (options: { value: string; label: string }[], values: string[]) => [
    ...options,
    ...values
      .filter((value) => !options.some((option) => option.value === value))
      .map((value) => ({ value, label: display(value) })),
  ];
  const computedApplicationOptions = useMemo(
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
  // 签名 = 选项值序列：稳态下连接集合不变（只有字节在变），选项引用保持不变，
  // antd Select 不再逐秒 reconcile。
  const applicationOptions = useStable(
    computedApplicationOptions,
    computedApplicationOptions.map((option) => option.value).join('\u0001')
  );
  const applicationSelectOptions = useStable(
    withSelected(applicationOptions, selectedApplications),
    `${applicationOptions.map((option) => option.value).join('\u0001')}#${selectedApplications.join('\u0001')}`
  );
  const computedOutboundOptions = useMemo(
    () =>
      [...new Set(all.map(connectionOutbound))].map((value) => ({ value, label: display(value) })),
    [all, display]
  );
  const outboundOptions = useStable(
    computedOutboundOptions,
    computedOutboundOptions.map((option) => option.value).join('\u0001')
  );
  const outboundSelectOptions = useStable(
    withSelected(outboundOptions, selectedOutbounds),
    `${outboundOptions.map((option) => option.value).join('\u0001')}#${selectedOutbounds.join('\u0001')}`
  );
  const computedNetworks = useMemo(
    () =>
      [
        ...new Set(
          all.flatMap((c) => (c.metadata?.network ? [c.metadata.network.toLowerCase()] : []))
        ),
      ].map((value) => ({ value, label: value.toUpperCase() })),
    [all]
  );
  const networks = useStable(
    computedNetworks,
    computedNetworks.map((option) => option.value).join('\u0001')
  );
  // 列定义随 applications（已锁引用）memo 化：实时帧期间 antd Table 不再每秒重建列。
  const columns = useMemo(() => buildConnectionColumns(t, applications), [t, applications]);
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
          selection={graphSelection}
        />
        <TablePanel>
          {/* 焦点进出走 React 合成的 focusin/focusout（onFocus/onBlur 冒泡）：进入表单挂起实时帧，
              焦点仍在表单内部转移（relatedTarget 命中）不恢复，真正离开才恢复并补最新帧。 */}
          <div
            onFocus={() => {
              pausedRef.current = true;
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                event.currentTarget.contains(event.relatedTarget as Node)
              )
                return;
              pausedRef.current = false;
              const held = heldFrameRef.current;
              if (held) {
                heldFrameRef.current = undefined;
                setSnapshot(held);
              }
            }}
          >
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
                options={applicationSelectOptions}
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
                options={outboundSelectOptions}
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
          </div>
          <Table
            rowKey="id"
            dataSource={filtered}
            orderBy={(row) => {const value=connectionDestination(row);return value===UNKNOWN_DESTINATION?'':value;}}
            columns={columns}
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
