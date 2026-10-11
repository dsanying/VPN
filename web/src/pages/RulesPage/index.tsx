import { PlusOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildTablePagination, AppPage, PageStack, Table, TablePanel, SummaryStrip, HelpTip } from '@/components/client';
import { RegionIcon } from '@/components/vpn/NodeRegionIcon';
import { ConfigBoundary } from '@/components/vpn/ConfigBoundary';
import { useAppStore } from '@/store/app-store';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import type { Rule } from '@shared/types';
import { RuleEditor } from './RuleEditor';
import { buildRuleColumns } from './columns';
import { ApplicationPicker } from '../AppsPage/ApplicationPicker';
import { useInstalledApplications } from '@/hooks/use-installed-applications';
import { patchConfig } from '@/store/config-mutations';
import { unifiedUserRules, withUnifiedUserRules } from '@shared/unified-rules';
export default function RulesPage(){
 const config=useAppStore(s=>s.config);const routing=useAppStore(s=>s.ipInfo?.smartRouting);const {t,i18n}=useTranslation();const [open,setOpen]=useState(false);const [editing,setEditing]=useState<Rule>();
 const [picker,setPicker]=useState(false);const [applicationEditing,setApplicationEditing]=useState<Rule>();
 const country=routing?.countryCode?new Intl.DisplayNames([i18n.language],{type:'region'}).of(routing.countryCode.toUpperCase()):undefined;
 const regionValue=country??(routing?.status==='unavailable'?t('common.vocab.unidentified'):t('common.loading'));
 const policyValue=routing?.status==='ready'?t('vpn.sameRegionDirect'):routing?.status==='preparing'?t('vpn.preparingRegion'):t('vpn.regionProxyFallback');
 const toggle=async(rule:Rule,enabled:boolean)=>{try{await patchConfig(current=>withUnifiedUserRules(current,unifiedUserRules(current).map(r=>r.id===rule.id?{...r,enabled}:r)));notifyActionSuccess(enabled?'enable':'disable');}catch(e){notifyActionFailed('save',e);}};
 const remove=async(id:string)=>{try{await patchConfig(current=>withUnifiedUserRules(current,unifiedUserRules(current).filter(r=>r.id!==id)));notifyActionSuccess('delete');}catch(e){notifyActionFailed('delete',e);}};
 const {applications}=useInstalledApplications();
 const rules=config?unifiedUserRules(config):[];
 return <AppPage showBreadcrumb={false} extra={<Dropdown trigger={['click']} menu={{items:[{key:'match',label:t('common.vocab.matchRules')},{key:'application',label:t('common.vocab.applicationRules')}],onClick:({key})=>{if(key==='application'){setApplicationEditing(undefined);setPicker(true);}else{setEditing(undefined);setOpen(true);}}}}><Button type="primary" icon={<PlusOutlined aria-hidden/>}>{t('common.actions.create')}</Button></Dropdown>}><ConfigBoundary><PageStack>
 <SummaryStrip compact label={t('vpn.rulesOverview')} items={[
  {key:'region',label:t('vpn.automaticRegion'),value:<Space size="small"><RegionIcon code={routing?.countryCode} name={regionValue}/>{regionValue}</Space>},
  {key:'effect',label:<Space size="small">{t('common.vocab.routing')}<HelpTip title={config?.proxyMode==='global'?t('vpn.rulesGlobal'):config?.proxyMode==='direct'?t('vpn.rulesDirect'):t('vpn.rulesSmartHelp',{policy:policyValue})}/></Space>,value:t(config?.proxyMode==='global'?'common.vocab.globalProxy':config?.proxyMode==='direct'?'common.vocab.direct':'common.vocab.smartRouting')},
  {key:'priority',label:<Space size="small">{t('vpn.rulesSequence')}<HelpTip title={t('vpn.rulesPriority')}/></Space>,value:t('vpn.rulesTopDown')},
 ]}/>
 <TablePanel><Table rowKey="id" dataSource={rules} columns={buildRuleColumns(t,rule=>{if(rule.application){setApplicationEditing(rule);setPicker(true);}else{setEditing(rule);setOpen(true);}},remove,toggle,applications,config)} pagination={buildTablePagination()} order="given" sortable={{handleLabel:t('vpn.rulesOrder'),onMove:async(_,from,to)=>{const next=rules.map(r=>r.id);const [id]=next.splice(from,1);next.splice(to,0,id);try{await patchConfig(current=>{const all=unifiedUserRules(current);const byId=new Map(all.map(rule=>[rule.id,rule]));if(next.length!==byId.size||next.some(id=>!byId.has(id)))throw new Error(t('vpn.invalidJson'));return withUnifiedUserRules(current,next.map(id=>byId.get(id)!));});notifyActionSuccess('save');}catch(error){notifyActionFailed('save',error);}}}}/></TablePanel>
 {open?<RuleEditor rule={editing} onClose={()=>setOpen(false)}/>:null}
 {picker?<ApplicationPicker rule={applicationEditing} onClose={()=>setPicker(false)}/>:null}
 </PageStack></ConfigBoundary></AppPage>;
}
