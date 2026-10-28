import { nodeAvailabilityLabel } from '@/components/vpn/nodeAvailabilityLabel';
import { RegionIcon } from '@/components/vpn/NodeRegionIcon';
import { NODE_PROTOCOLS } from '@shared/protocol-catalog';
import { nodeRegionCode } from '@shared/node-identity';
import { cachedNodeAvailability } from '@/components/vpn/cachedNodeAvailability';
import { useShallow } from 'zustand/react/shallow';
import { useMeasurementClock } from '@/components/vpn/useMeasurementClock';
import { NodeGroupTable } from './NodeGroupTable';
import './NodesPage.css';
import { isSubscriptionNotice } from '@shared/subscription-notice';
import {
  PlusOutlined,
  UploadOutlined,
  DownOutlined,
  CloudDownloadOutlined,
  ThunderboltOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Form, Select } from 'antd';
import { useMemo, useState } from 'react';
import { regionDisplayName } from '@/components/vpn/nodeDisplayCache';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  AppPage,
  PageStack,
  SearchInput,
  ResponsiveActions,
  QueryForm,
  FilterSelect,
} from '@/components/client';
import { ConfigBoundary } from '@/components/vpn/ConfigBoundary';
import { useAppStore } from '@/store/app-store';
import { api } from '@/ipc';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { groupServersBySubscription } from '@shared/server-grouping';
import type { ServerConfig, SubscriptionConfig } from '@shared/types';
import { now } from '@/utils/dateTime';
import { NodeConnectionControls, NodeRoutingControl } from './NodeConnectionControls';
import { useNodes } from './useNodes';
import { NodeList } from './NodeList';
import { compareText } from '@/utils/collation';
import { NodeEditor } from './NodeEditor';
import { SubscriptionEditor } from './SubscriptionEditor';
import { ImportEditor } from './ImportEditor';
const EMPTY_SERVERS: ServerConfig[] = [];
const EMPTY_SUBSCRIPTIONS: SubscriptionConfig[] = [];
export default function NodesPage() {
  const availabilityContext = useAppStore(
    useShallow((s) => ({
      config: s.config,
      latencyMap: s.latencyMap,
      latencyTestedAt: s.latencyTestedAt,
      pendingChanges: s.pendingChanges,
      tailscaleLoginStates: s.tailscaleLoginStates,
      running: !!s.connectionStatus?.proxyCore.running,
      blocked: s.ipInfo?.proxyBlocked,
      probeDetails: s.probeDetails,
    }))
  );
  const { config, latencyMap: latencies } = availabilityContext;
  const { t, i18n } = useTranslation();
  const time = useMeasurementClock();
  const details = useAppStore((s) => s.probeDetails);
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<'node' | 'subscription' | 'import' | undefined>(
    params.get('add') === 'subscription' ? 'subscription' : undefined
  );
  const [node, setNode] = useState<ServerConfig>();
  const [subscription, setSubscription] = useState<SubscriptionConfig>();
  const [group, setGroup] = useState<string[]>(params.get('source') ? [params.get('source')!] : []);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('original');
  const [protocol, setProtocol] = useState<string[]>([]);
  const [region, setRegion] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);
  const actions = useNodes();
  const servers = config?.servers ?? EMPTY_SERVERS;
  const subscriptions = config?.subscriptions ?? EMPTY_SUBSCRIPTIONS;
  const groups = useMemo(
    () =>
      groupServersBySubscription(
        servers.filter((n) => !isSubscriptionNotice(n.name)),
        subscriptions,
        { includeEmptySubscriptions: true }
      ),
    [servers, subscriptions]
  );
  const source = group;
  const sourceNodes = group.length
    ? groups.filter((item) => group.includes(item.id)).flatMap((item) => item.servers)
    : servers;
  const sourceOptions = useMemo(
    () => [
      ...groups.map((item) => ({
        value: item.id,
        label: item.isManual
          ? t('common.vocab.manualNodes')
          : item.isMesh
            ? t('common.vocab.meshNetworking')
            : item.name,
      })),
    ],
    [groups, t]
  );
  const ordered = useMemo(() => {
    const query = search.toLowerCase();
    const filtered = sourceNodes.filter(
      (n) =>
        !isSubscriptionNotice(n.name) &&
        `${n.name} ${n.address} ${n.protocol}`.toLowerCase().includes(query) &&
        (!protocol.length || protocol.includes(n.protocol)) &&
        (!region.length || region.includes(nodeRegionCode(details[n.id]) ?? 'unknown')) &&
        (!availability.length ||
          availability.includes(cachedNodeAvailability(availabilityContext, n.id, time)))
    );
    if (sort === 'original') return filtered;
    return filtered.sort((a, b) =>
      sort === 'name'
        ? compareText(a.name, b.name)
        : (latencies[a.id] >= 0 ? latencies[a.id] : Infinity) -
            (latencies[b.id] >= 0 ? latencies[b.id] : Infinity) || compareText(a.name, b.name)
    );
  }, [
    sourceNodes,
    search,
    protocol,
    region,
    availability,
    sort,
    details,
    latencies,
    availabilityContext,
    time,
  ]);
  const location = useLocation();
  const navigate = useNavigate();
  const managing = location.pathname === '/nodes/groups';
  const manage = (open: boolean) => navigate(open ? '/nodes/groups' : '/nodes');

  const protocolOptions = useMemo(
    () =>
      NODE_PROTOCOLS.map((value) => ({
        value,
        label:
          value === 'enterprise'
            ? t('vpn.enterprise.title')
            : value === 'custom'
              ? t('common.vocab.customProtocol')
              : value.toUpperCase(),
      })),
    [t]
  );
  const regionOptions = useMemo(
    () =>
      [...new Set(servers.map((n) => nodeRegionCode(details[n.id]) ?? 'unknown'))].map((value) => {
        const name =
          value === 'unknown'
            ? t('common.vocab.unidentified')
            : (regionDisplayName(i18n.language, value) ?? value);
        return {
          value,
          searchText: name,
          label: (
            <span className="vpn-region-option">
              <RegionIcon code={value === 'unknown' ? undefined : value} name={name} />
              <span>{name}</span>
            </span>
          ),
        };
      }),
    [servers, details, i18n.language, t]
  );
  const close = () => {
    setEditor(undefined);
    params.delete('add');
    setParams(params, { replace: true });
  };
  const select = async (n: ServerConfig) => {
    try {
      await api.server.switch(n.id);
      await actions.reload();
      notifyActionSuccess('use', n.name);
    } catch (e) {
      notifyActionFailed('use', e);
    }
  };
  const clone = async (n: ServerConfig) => {
    try {
      const stamp = now().toISOString();
      const clone = {
        ...structuredClone(n),
        name: t('common.actionObjectTemplates.clone', { object: n.name }),
        id: crypto.randomUUID(),
        subscriptionId: undefined,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await api.server.add(clone);
      await actions.reload();
      notifyActionSuccess('clone');
    } catch (e) {
      notifyActionFailed('clone', e);
    }
  };
  const addMenu = {
    items: [
      {
        key: 'subscription',
        label: t('vpn.addSubscription'),
        icon: <CloudDownloadOutlined aria-hidden />,
      },
      { key: 'node', label: t('common.vocab.addNode'), icon: <PlusOutlined aria-hidden /> },
      { key: 'import', label: t('vpn.importNodes'), icon: <UploadOutlined aria-hidden /> },
    ],
    onClick: ({ key }: { key: string }) => {
      setNode(undefined);
      setSubscription(undefined);
      setEditor(key as 'subscription' | 'node' | 'import');
    },
  };
  if (managing)
    return (
      <AppPage
        showBreadcrumb={false}
        onBack={() => manage(false)}
        extra={
          <Dropdown trigger={['click']} menu={addMenu}>
            <Button icon={<PlusOutlined aria-hidden />} type="primary">
              {t('common.actions.add')}
              <DownOutlined aria-hidden />
            </Button>
          </Dropdown>
        }
      >
        <ConfigBoundary>
          <PageStack>
            <NodeGroupTable
              servers={servers}
              subscriptions={subscriptions}
              updating={actions.updating}
              refresh={(id) => void actions.refreshSubscription(id)}
              edit={(sub) => {
                setSubscription(sub);
                setEditor('subscription');
              }}
              remove={actions.removeSubscription}
              viewNodes={(id) => {
                setGroup([id]);
                navigate(`/nodes?source=${encodeURIComponent(id)}`);
              }}
            />
            {editor === 'node' ? <NodeEditor node={node} onClose={close} /> : null}
            {editor === 'subscription' ? (
              <SubscriptionEditor
                subscription={subscription}
                onClose={close}
                save={actions.saveSubscription}
              />
            ) : null}
            {editor === 'import' ? <ImportEditor onClose={close} /> : null}
          </PageStack>
        </ConfigBoundary>
      </AppPage>
    );
  return (
    <AppPage
      scrollMode="contained"
      className="vpn-nodes-page"
      showBreadcrumb={false}
      extra={
        <ResponsiveActions>
          <Button
            icon={<SettingOutlined aria-hidden />}
            type="primary"
            onClick={() => manage(true)}
          >
            {t('common.actions.manage')}
          </Button>
          <Button
            icon={<ThunderboltOutlined aria-hidden />}
            title={t('vpn.nodeDetectionHint')}
            loading={actions.testing.length > 0}
            onClick={() => void actions.test(servers, true)}
          >
            {t('vpn.testAll')}
          </Button>
        </ResponsiveActions>
      }
    >
      <ConfigBoundary>
        <PageStack className="vpn-nodes-page__stack" gap="control">
          <NodeConnectionControls
            onAddSubscription={() => {
              setNode(undefined);
              setSubscription(undefined);
              setEditor('subscription');
            }}
          />
          <QueryForm mode="local" aria-label={t('common.vocab.search')}>
            <Form.Item label={t('common.vocab.routing')} data-query-control="operation">
              <NodeRoutingControl />
            </Form.Item>
            <Form.Item label={t('common.vocab.source')} data-filter-field="node.subscriptionId">
              <FilterSelect
                kind="enum"
                aria-label={t('common.vocab.source')}
                value={source}
                onChange={setGroup}
                options={sourceOptions}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.search')} data-filter-purpose="keyword">
              <SearchInput
                aria-label={t('common.vocab.search')}
                allowClear
                hint={t('vpn.searchHint')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.protocol')} data-filter-field="node.protocol">
              <FilterSelect
                kind="enum"
                aria-label={t('common.vocab.protocol')}
                value={protocol}
                onChange={setProtocol}
                options={protocolOptions}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.region')} data-filter-field="node.region">
              <FilterSelect
                kind="enum"
                aria-label={t('common.vocab.region')}
                popupMatchSelectWidth={false}
                value={region}
                onChange={setRegion}
                options={regionOptions}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.status')} data-filter-field="node.availability">
              <FilterSelect
                kind="enum"
                aria-label={t('common.vocab.status')}
                value={availability}
                onChange={setAvailability}
                options={(['available', 'failed', 'stale', 'untested', 'unknown'] as const).map(
                  (value) => ({ value, label: nodeAvailabilityLabel(value, t) })
                )}
              />
            </Form.Item>
            <Form.Item label={t('common.vocab.sort')} data-query-control="ordering">
              <Select
                className="vpn-node-filter"
                aria-label={t('common.vocab.sort')}
                allowClear={false}
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'original', label: t('vpn.originalOrder') },
                  { value: 'name', label: t('common.vocab.name') },
                  { value: 'latency', label: t('vpn.proxyLatency') },
                ]}
              />
            </Form.Item>
          </QueryForm>

          <div
            className="vpn-nodes-page__list"
            tabIndex={0}
            role="region"
            aria-label={t('vpn.nodeList')}
          >
            <NodeList
              nodes={ordered}
              suppressGroup={source.length === 1}
              selected={config?.selectedServerId ?? null}
              testing={actions.testing}
              select={select}
              edit={(n) => {
                setNode(n);
                setEditor('node');
              }}
              remove={actions.removeNode}
              test={actions.test}
              clone={clone}
            />
          </div>
          {editor === 'node' ? <NodeEditor node={node} onClose={close} /> : null}
          {editor === 'subscription' ? (
            <SubscriptionEditor
              subscription={subscription}
              onClose={close}
              save={actions.saveSubscription}
            />
          ) : null}
          {editor === 'import' ? <ImportEditor onClose={close} /> : null}
        </PageStack>
      </ConfigBoundary>
    </AppPage>
  );
}
