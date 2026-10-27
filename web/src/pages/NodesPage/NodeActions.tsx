import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, type MenuProps } from 'antd';
import { CheckCircleOutlined, CopyOutlined, DeleteOutlined, EditOutlined, LinkOutlined, MoreOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { IconButton, Popconfirm, ResponsiveActions, useCopyToClipboard } from '@/components/client';
import { api } from '@/ipc';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import type { ServerConfig } from '@shared/types';

export function NodeActions({node,selected,testing,select,edit,remove,test,clone,variant}: {
  node:ServerConfig; selected:boolean; testing:boolean;
  select:(node:ServerConfig)=>void; edit:(node:ServerConfig)=>void;
  remove:(id:string)=>Promise<boolean>; test:(nodes:ServerConfig[])=>Promise<void>; clone:(node:ServerConfig)=>Promise<void>;
  /** 卡片视图：不渲染「设为默认」按钮（点卡片即启用），操作收纳为测速/更多两个图标钮。 */
  variant?: 'card';
}) {
  const {t}=useTranslation(); const {copy}=useCopyToClipboard();
  const [deleting,setDeleting]=useState(false); const [busy,setBusy]=useState(false);
  const items:MenuProps['items']=[
    {key:'edit',label:t('common.actions.edit'),icon:<EditOutlined aria-hidden/>},
    ...(node.protocol === 'enterprise' ? [] : [{key:'copy',label:t('vpn.copyLink'),icon:<LinkOutlined aria-hidden/>},
    {key:'clone',label:t('vpn.saveAsNode'),icon:<CopyOutlined aria-hidden/>}]),
    ...(!node.subscriptionId?[{type:'divider' as const},{key:'delete',label:t('common.actions.delete'),icon:<DeleteOutlined aria-hidden/>,danger:true}]:[]),
  ];
  const onClick:MenuProps['onClick']=({key})=>{
    if(key==='edit')edit(node);
    if(key==='delete')setDeleting(true);
    if(key==='clone')void clone(node);
    if(key==='copy')void (async()=>{try{if(await copy(await api.server.generateUrl(node)))notifyActionSuccess('copy');}catch(error){notifyActionFailed('copy',error);}})();
  };
  if (variant === 'card')
    return <>
      <IconButton size="small" icon={<ThunderboltOutlined aria-hidden />} label={t('common.vocab.testLatency')} loading={testing} onClick={()=>void test([node])} />
      <Popconfirm open={deleting} title={t('common.confirm.execute')} description={t('vpn.deleteImpact')} okButtonProps={{danger:true,loading:busy}} onConfirm={async()=>{setBusy(true);try{if(await remove(node.id))setDeleting(false);}finally{setBusy(false);}}} onCancel={()=>{if(!busy)setDeleting(false);}}>
        <Dropdown trigger={['click']} placement="bottomRight" menu={{items,onClick}} disabled={deleting}><IconButton size="small" icon={<MoreOutlined aria-hidden />} label={t('common.actions.more')} /></Dropdown>
      </Popconfirm>
    </>;
  return <><ResponsiveActions justify="start">
    <Button size="small" icon={<CheckCircleOutlined aria-hidden/>} disabled={selected} onClick={()=>select(node)}>{t(selected?'common.vocab.current':'vpn.setDefaultNode')}</Button>
    <Button size="small" icon={<ThunderboltOutlined aria-hidden/>} title={t('vpn.nodeDetectionHint')} loading={testing} onClick={()=>void test([node])}>{t('common.vocab.testLatency')}</Button>
    <Popconfirm open={deleting} title={t('common.confirm.execute')} description={t('vpn.deleteImpact')} okButtonProps={{danger:true,loading:busy}} onConfirm={async()=>{setBusy(true);try{if(await remove(node.id))setDeleting(false);}finally{setBusy(false);}}} onCancel={()=>{if(!busy)setDeleting(false);}}>
      <Dropdown trigger={['click']} placement="bottomRight" menu={{items,onClick}} disabled={deleting}><Button size="small" icon={<MoreOutlined aria-hidden/>}>{t('common.actions.more')}</Button></Dropdown>
    </Popconfirm>
  </ResponsiveActions></>;
}
