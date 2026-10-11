import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Modal, type MenuProps } from 'antd';
import { CheckCircleOutlined, CopyOutlined, DeleteOutlined, EditOutlined, LinkOutlined, MoreOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ResponsiveActions, useCopyToClipboard } from '@/components/client';
import { api } from '@/ipc';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import type { ServerConfig } from '@shared/types';

export function NodeActions({node,selected,testing,select,edit,remove,test,clone}: {
  node:ServerConfig; selected:boolean; testing:boolean;
  select:(node:ServerConfig)=>void; edit:(node:ServerConfig)=>void;
  remove:(id:string)=>Promise<boolean>; test:(nodes:ServerConfig[])=>Promise<void>; clone:(node:ServerConfig)=>Promise<void>;
}) {
  const {t}=useTranslation(); const {copy}=useCopyToClipboard();
  const [deleting,setDeleting]=useState(false); const [busy,setBusy]=useState(false);
  const items:MenuProps['items']=[
    {key:'edit',label:t('common.actions.edit'),icon:<EditOutlined aria-hidden/>},
    {key:'copy',label:t('vpn.copyLink'),icon:<LinkOutlined aria-hidden/>},
    {key:'clone',label:t('vpn.saveAsNode'),icon:<CopyOutlined aria-hidden/>},
    ...(!node.subscriptionId?[{type:'divider' as const},{key:'delete',label:t('common.actions.delete'),icon:<DeleteOutlined aria-hidden/>,danger:true}]:[]),
  ];
  const onClick:MenuProps['onClick']=({key})=>{
    if(key==='edit')edit(node);
    if(key==='delete')setDeleting(true);
    if(key==='clone')void clone(node);
    if(key==='copy')void (async()=>{try{if(await copy(await api.server.generateUrl(node)))notifyActionSuccess('copy');}catch(error){notifyActionFailed('copy',error);}})();
  };
  return <><ResponsiveActions justify="start">
    <Button size="small" icon={<CheckCircleOutlined aria-hidden/>} disabled={selected} onClick={()=>select(node)}>{t(selected?'common.vocab.current':'common.vocab.use')}</Button>
    <Button size="small" icon={<ThunderboltOutlined aria-hidden/>} loading={testing} onClick={()=>void test([node])}>{t('common.vocab.testLatency')}</Button>
    <Dropdown trigger={['click']} placement="bottomRight" menu={{items,onClick}}><Button size="small" icon={<MoreOutlined aria-hidden/>}>{t('common.actions.more')}</Button></Dropdown>
  </ResponsiveActions><Modal okButtonProps={{danger:true}} open={deleting} title={t('common.confirm.execute')} confirmLoading={busy} onCancel={()=>{if(!busy)setDeleting(false);}} onOk={async()=>{setBusy(true);try{if(await remove(node.id))setDeleting(false);}finally{setBusy(false);}}}>
    {t('vpn.deleteImpact')}
  </Modal></>;
}
