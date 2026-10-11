import {nodeAvailabilityLabel} from '@/components/vpn/nodeAvailabilityLabel';
import {RegionIcon} from '@/components/vpn/NodeRegionIcon';
import {normalizeCountryCode} from '@shared/country';
import {cachedNodeAvailability} from '@/components/vpn/cachedNodeAvailability';
import {useShallow} from 'zustand/react/shallow';
import {useMeasurementClock} from '@/components/vpn/useMeasurementClock';
import { NodeGroupTable } from './NodeGroupTable';
import './NodesPage.css';
import {isSubscriptionNotice} from '@shared/subscription-notice';
import { PlusOutlined, UploadOutlined, DownOutlined, CloudDownloadOutlined, ThunderboltOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Dropdown, Form, Progress, Select } from 'antd';
import { useMemo, useState } from 'react';
import { regionDisplayName } from '@/components/vpn/nodeDisplayCache';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppPage, PageStack, SearchInput, ResponsiveActions, Stack } from '@/components/client';
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
  const availabilityContext=useAppStore(useShallow(s=>({config:s.config,latencyMap:s.latencyMap,latencyTestedAt:s.latencyTestedAt,pendingChanges:s.pendingChanges,tailscaleLoginStates:s.tailscaleLoginStates,running:!!s.connectionStatus?.proxyCore.running,blocked:s.ipInfo?.proxyBlocked,probeDetails:s.probeDetails})));
  const {config,latencyMap:latencies}=availabilityContext;
  const {t,i18n}=useTranslation(); const time=useMeasurementClock(); const details=useAppStore(s=>s.probeDetails); const [params,setParams]=useSearchParams();
  const [editor,setEditor]=useState<'node'|'subscription'|'import'|undefined>(params.get('add') === 'subscription' ? 'subscription' : undefined);
  const [node,setNode]=useState<ServerConfig>(); const [subscription,setSubscription]=useState<SubscriptionConfig>();
  const [group,setGroup]=useState(params.get('source') ?? 'all'); const [search,setSearch]=useState(''); const [sort,setSort]=useState('original');
  const [protocol,setProtocol]=useState<string>(); const [region,setRegion]=useState<string>(); const [availability,setAvailability]=useState<string>();
  const actions = useNodes(); const servers=config?.servers ?? EMPTY_SERVERS; const subscriptions=config?.subscriptions ?? EMPTY_SUBSCRIPTIONS;
  const groups = useMemo(() => groupServersBySubscription(servers.filter(n => !isSubscriptionNotice(n.name)), subscriptions, {includeEmptySubscriptions:true}), [servers, subscriptions]);
  const activeGroup = groups.find(item => item.id === group);
  const source = activeGroup?.id ?? 'all';
  const sourceNodes = activeGroup?.servers ?? servers;
  const sourceOptions = useMemo(() => [{value:'all',label:t('common.vocab.allNodes')}, ...groups.map(item => ({value:item.id,label:item.isManual ? t('common.vocab.manualNodes') : item.isMesh ? t('common.vocab.meshNetworking') : item.name}))], [groups,t]);
  const ordered = useMemo(() => {
    const query = search.toLowerCase();
    const filtered = sourceNodes.filter(n => !isSubscriptionNotice(n.name)
      && `${n.name} ${n.address} ${n.protocol}`.toLowerCase().includes(query)
      && (!protocol || n.protocol === protocol)
      && (!region || (normalizeCountryCode(details[n.id]?.exit?.countryCode) ?? 'unknown') === region)
      && (!availability || cachedNodeAvailability(availabilityContext,n.id,time) === availability));
    if (sort === 'original') return filtered;
    return filtered.sort((a,b) => sort === 'name' ? compareText(a.name,b.name) : ((latencies[a.id]>=0?latencies[a.id]:Infinity)-(latencies[b.id]>=0?latencies[b.id]:Infinity) || compareText(a.name,b.name)));
  }, [sourceNodes, search, protocol, region, availability, sort, details, latencies, availabilityContext, time]);
  const location = useLocation();
  const navigate = useNavigate();
  const managing = location.pathname === '/nodes/groups';
  const manage = (open: boolean) => navigate(open ? '/nodes/groups' : '/nodes');

  const protocolOptions = useMemo(() => [...new Set(servers.map(n => n.protocol))].map(value => ({value,label:value.toUpperCase()})), [servers]);
  const regionOptions = useMemo(() => [...new Set(servers.map(n => normalizeCountryCode(details[n.id]?.exit?.countryCode) ?? 'unknown'))].map(value => {
    const name = value === 'unknown' ? t('common.vocab.unidentified') : regionDisplayName(i18n.language, value) ?? value;
    return {value,label:<span className="vpn-region-option"><RegionIcon code={value === 'unknown' ? undefined : value} name={name}/><span>{name}</span></span>};
  }), [servers, details, i18n.language, t]);
  const close=()=>{setEditor(undefined);params.delete('add');setParams(params,{replace:true});};
  const select=async(n:ServerConfig)=>{try{await api.server.switch(n.id);await actions.reload();notifyActionSuccess('use',n.name);}catch(e){notifyActionFailed('use',e);}};
  const clone=async(n:ServerConfig)=>{try{const stamp=now().toISOString();const clone={...structuredClone(n),name:t('common.actionObjectTemplates.clone',{object:n.name}),id:crypto.randomUUID(),subscriptionId:undefined,createdAt:stamp,updatedAt:stamp};await api.server.add(clone);await actions.reload();notifyActionSuccess('clone');}catch(e){notifyActionFailed('clone',e);}};
  const addMenu = { items: [
    {key:'subscription',label:t('vpn.addSubscription'),icon:<CloudDownloadOutlined aria-hidden/>},
    {key:'node',label:t('common.vocab.addNode'),icon:<PlusOutlined aria-hidden/>},
    {key:'import',label:t('vpn.importNodes'),icon:<UploadOutlined aria-hidden/>},
  ], onClick:({key}:{key:string})=>{setNode(undefined);setSubscription(undefined);setEditor(key as 'subscription'|'node'|'import');} };
  if (managing) return <AppPage showBreadcrumb={false} onBack={() => manage(false)} extra={<Dropdown trigger={['click']} menu={addMenu}><Button icon={<PlusOutlined aria-hidden/>} type="primary">{t('common.actions.add')}<DownOutlined aria-hidden/></Button></Dropdown>}><ConfigBoundary><PageStack>
    <NodeGroupTable servers={servers} subscriptions={subscriptions} updating={actions.updating} refresh={id => void actions.refreshSubscription(id)} edit={sub => {setSubscription(sub);setEditor('subscription');}} remove={actions.removeSubscription} viewNodes={id => {setGroup(id);navigate(`/nodes?source=${encodeURIComponent(id)}`);}} />
    {editor==='node' ? <NodeEditor node={node} onClose={close} /> : null}{editor==='subscription' ? <SubscriptionEditor subscription={subscription} onClose={close} save={actions.saveSubscription} /> : null}{editor==='import' ? <ImportEditor onClose={close} /> : null}
  </PageStack></ConfigBoundary></AppPage>;
  return <AppPage scrollMode="contained" className="vpn-nodes-page" showBreadcrumb={false} extra={<ResponsiveActions><Button icon={<SettingOutlined aria-hidden/>} type="primary" onClick={() => manage(true)}>{t('common.actions.manage')}</Button><Button icon={<ThunderboltOutlined aria-hidden/>} loading={actions.testing.length>0} onClick={()=>void actions.test(servers,true)}>{t('vpn.testAll')}</Button></ResponsiveActions>}><ConfigBoundary><PageStack className="vpn-nodes-page__stack">
    <NodeConnectionControls onAddSubscription={() => {setNode(undefined);setSubscription(undefined);setEditor('subscription');}} />
    <Form layout="inline" className="vpn-nodes-page__filters" data-client-overflow="x" tabIndex={0} role="region" aria-label={t('common.vocab.search')}><Form.Item label={t('common.vocab.routing')}><NodeRoutingControl/></Form.Item><Form.Item label={t('common.vocab.source')}><Select className="vpn-node-filter" aria-label={t('common.vocab.source')} allowClear={false} value={source} onChange={setGroup} options={sourceOptions} /></Form.Item></Form>
    <Form layout="inline" className="vpn-nodes-page__filters" data-client-overflow="x" tabIndex={0} role="region" aria-label={t('common.vocab.search')}><Form.Item label={t('common.vocab.search')}><SearchInput aria-label={t('common.vocab.search')} allowClear hint={t('vpn.searchHint')} value={search} onChange={e=>setSearch(e.target.value)}/></Form.Item><Form.Item label={t('common.vocab.protocol')}><Select className="vpn-node-filter" aria-label={t('common.vocab.protocol')} allowClear value={protocol} onChange={setProtocol} options={protocolOptions}/></Form.Item><Form.Item label={t('common.vocab.region')}><Select className="vpn-node-filter" aria-label={t('common.vocab.region')} popupMatchSelectWidth={false} allowClear value={region} onChange={setRegion} options={regionOptions}/></Form.Item><Form.Item label={t('common.vocab.status')}><Select className="vpn-node-filter" aria-label={t('common.vocab.status')} allowClear value={availability} onChange={setAvailability} options={(['available','failed','stale','untested','unknown'] as const).map(value=>({value,label:nodeAvailabilityLabel(value,t)}))}/></Form.Item><Form.Item label={t('common.vocab.sort')}><Select className="vpn-node-filter" aria-label={t('common.vocab.sort')} allowClear={false} value={sort} onChange={setSort} options={[{value:'original',label:t('vpn.originalOrder')},{value:'name',label:t('common.vocab.name')},{value:'latency',label:t('vpn.proxyLatency')}]}/></Form.Item><Button icon={<ReloadOutlined aria-hidden/>} onClick={()=>{setSearch('');setProtocol(undefined);setRegion(undefined);setAvailability(undefined);setSort('original');}}>{t('common.actions.reset')}</Button></Form>

    {actions.testing.length ? <Stack direction="column" gap="control"><span role="status">{t('vpn.testing',{ok:actions.progress.ok,tested:actions.progress.tested,total:actions.progress.total})}</span><Progress percent={Math.round(actions.progress.tested/Math.max(actions.progress.total,1)*100)} /></Stack> : null}
    <div className="vpn-nodes-page__list" tabIndex={0} role="region" aria-label={t('vpn.nodeList')}><NodeList nodes={ordered} selected={config?.selectedServerId??null} testing={actions.testing} select={select} edit={n=>{setNode(n);setEditor('node');}} remove={actions.removeNode} test={actions.test} clone={clone} /></div>
    {editor==='node' ? <NodeEditor node={node} onClose={close} /> : null}{editor==='subscription' ? <SubscriptionEditor subscription={subscription} onClose={close} save={actions.saveSubscription} /> : null}{editor==='import' ? <ImportEditor onClose={close} /> : null}
  </PageStack></ConfigBoundary></AppPage>;
}
