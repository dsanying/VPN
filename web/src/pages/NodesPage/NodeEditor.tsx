import { actionColor } from '@/config/theme';
import { DesktopSection } from '@/components/vpn/DesktopSection';
import {networkLabels} from '@/i18n/vpnLabels';
import { Button, Form, Input, InputNumber } from 'antd';
import { LoginOutlined, LogoutOutlined, CloseOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DrawerForm, MultiSelect, FormGrid, ResponsiveActions, Popconfirm } from '@/components/client';
import { JsonEditor } from '@/components/JsonEditor';
import { api } from '@/ipc';
import { useAppStore } from '@/store/app-store';
import { formatJson, parseJsonText } from '@/utils/json';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { isServerComplete } from '@shared/server-completeness';
import type { ServerConfig } from '@shared/types';
import { mergeNodeDraft } from './nodeModel';
export function NodeEditor({ node, onClose }: { node?: ServerConfig; onClose: () => void }) {
  const { t } = useTranslation(); const [form] = Form.useForm();
  const [raw, setRaw] = useState(formatJson(node ?? {}) ?? '{}');
  const [source, setSource] = useState('');
  const [detected, setDetected] = useState<ServerConfig | undefined>(node);
  const protocol = detected?.protocol;
  const network = detected?.network;
  const security = detected?.security;
  const [detecting, setDetecting] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  useEffect(() => {
    if (!source.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      void api.localImport.parse(source).then(result => {
        if (!current) return;
        if (result.nodes.length !== 1 || result.subscriptions.length || result.stats.failed || result.stats.skipped) {
          setDetected(undefined); setSourceError(true); return;
        }
        const resolved = result.nodes[0];
        setDetected(resolved);
        setRaw(formatJson(resolved) ?? '{}');
        form.resetFields();
        form.setFieldsValue({ ...resolved, ...(node ? { name: node.name } : {}) });
      }, () => { if (current) { setDetected(undefined); setSourceError(true); } }).finally(() => { if (current) setDetecting(false); });
    }, 400);
    return () => { current = false; clearTimeout(timer); };
  }, [source, form, node]);
  const [sessionBusy,setSessionBusy]=useState(false);
  const loginInitiated=useAppStore(s=>node?s.tailscaleLoginInitiated[node.id]:false);
  const sessionAction=async(action:()=>Promise<void>,feedback:'login'|'cancel'|'logout')=>{setSessionBusy(true);try{await action();}catch(e){notifyActionFailed(feedback,e);}finally{setSessionBusy(false);}};
  return <DrawerForm<Partial<ServerConfig>> form={form} open title={t('common.vocab.nodes')} onOpenChange={open => { if (!open) onClose(); }} initialValues={{ ...node }} onFinish={async values => {
    try {
      if (detecting || sourceError || (!node && !detected) || (source.trim() && !detected)) { setSourceError(true); throw new Error(t('vpn.nodeSourceInvalid')); }
      const draft = mergeNodeDraft(node, values, parseJsonText(raw));
      if (!isServerComplete(draft)) throw new Error(t('vpn.validationRequired'));
      if (node) await api.server.update(draft); else await api.server.add(draft);
      await useAppStore.getState().loadConfig(); notifyActionSuccess('save'); return true;
    } catch (e) { notifyActionFailed('save',e);return false; }
  }}>
    <Form.Item label={t('vpn.nodeSource')} tooltip={t('vpn.nodeSourceHint')} validateStatus={sourceError ? 'error' : undefined} help={sourceError ? t('vpn.nodeSourceInvalid') : undefined}><Input.TextArea aria-label={t('vpn.nodeSource')} value={source} rows={2} onChange={event => {
      setSource(event.target.value); setDetecting(Boolean(event.target.value.trim())); setSourceError(false);
      if (!event.target.value.trim()) { setDetecting(false); setSourceError(false); setDetected(node); setRaw(formatJson(node ?? {}) ?? '{}'); form.resetFields(); }
    }} /></Form.Item>
    {detecting ? <span role="status">{t('vpn.detectingConfiguration')}</span> : null}
    <Form.Item label={t('common.vocab.name')} name="name" rules={[{required:true,whitespace:true}]}><Input allowClear /></Form.Item>
    <Form.Item label={t('common.vocab.protocol')} tooltip={t('vpn.automaticSourceHint')}><span role="status">{protocol?.toUpperCase() ?? t('vpn.awaitingSource')}</span></Form.Item>
    {protocol && protocol !== 'tailscale' && protocol !== 'custom' ? <FormGrid columns={2}><Form.Item label={t('common.vocab.address')} name="address" rules={[{required:true,whitespace:true}]}><Input allowClear /></Form.Item><Form.Item label={t('common.vocab.port')} name="port" rules={[{required:true}]}><InputNumber min={1} max={65535} /></Form.Item></FormGrid> : null}
    {['vmess','vless','tuic'].includes(protocol ?? '') ? <Form.Item label={t('vpn.uuid')} name="uuid" rules={[{required:true}]}><Input allowClear /></Form.Item> : null}
    {['trojan','shadowsocks','hysteria2','tuic','anytls','snell','socks','http','ssh','naive'].includes(protocol ?? '') ? <Form.Item label={t('common.vocab.password')} name={protocol==='shadowsocks'?['shadowsocksSettings','password']:'password'}><Input.Password allowClear /></Form.Item> : null}
    {['socks','http','ssh','naive'].includes(protocol ?? '') ? <Form.Item label={t('vpn.username')} name="username"><Input allowClear /></Form.Item> : null}
    {protocol === 'shadowsocks' ? <Form.Item label={t('vpn.method')}><span>{detected?.shadowsocksSettings?.method ?? t('vpn.configurationUnspecified')}</span></Form.Item> : null}
    {['vmess','vless','trojan'].includes(protocol ?? '') ? <FormGrid columns={2}><Form.Item label={t('vpn.network')} tooltip={t('vpn.automaticSourceHint')}><span role="status">{network ? networkLabels(t)[network as keyof ReturnType<typeof networkLabels>] ?? network.toUpperCase() : t('vpn.configurationUnspecified')}</span></Form.Item><Form.Item label={t('vpn.security')} tooltip={t('vpn.automaticSourceHint')}><span role="status">{security === 'none' ? t('common.vocab.unselected') : security === 'tls' ? t('vpn.tls') : security === 'reality' ? t('vpn.reality') : t('vpn.configurationUnspecified')}</span></Form.Item></FormGrid> : null}
    {protocol && !['tailscale', 'custom', 'shadowsocks', 'snell', 'wireguard'].includes(protocol ?? '') && security && security !== 'none' ? <Form.Item label={t('vpn.sni')} name={['tlsSettings','serverName']}><Input allowClear /></Form.Item> : null}
    {security === 'reality' ? <FormGrid columns={2}><Form.Item label={t('vpn.publicKey')} name={['realitySettings','publicKey']}><Input allowClear /></Form.Item><Form.Item label={t('vpn.shortId')} name={['realitySettings','shortId']}><Input allowClear /></Form.Item></FormGrid> : null}
    {network === 'ws' ? <Form.Item label={t('common.vocab.path')} name={['wsSettings','path']}><Input allowClear /></Form.Item> : null}
    {network === 'xhttp' ? <FormGrid columns={3}><Form.Item label={t('common.vocab.host')} name={['xhttpSettings','host']}><Input allowClear /></Form.Item><Form.Item label={t('common.vocab.path')} name={['xhttpSettings','path']}><Input allowClear /></Form.Item><Form.Item label={t('vpn.xhttpMode')}><span>{detected?.xhttpSettings?.mode ?? t('vpn.configurationUnspecified')}</span></Form.Item></FormGrid> : null}
    {network === 'grpc' ? <Form.Item label={t('vpn.serviceName')} name={['grpcSettings','serviceName']}><Input allowClear /></Form.Item> : null}
    {protocol === 'tailscale' ? <FormGrid columns={2}><Form.Item label={t('vpn.authKey')} name={['tailscaleSettings','authKey']}><Input.Password allowClear /></Form.Item><Form.Item label={t('vpn.exitNode')} name={['tailscaleSettings','exitNode']}><Input allowClear /></Form.Item></FormGrid> : null}
    {protocol==='tailscale'&&node?.protocol==='tailscale'?<ResponsiveActions justify="start"><Button color={actionColor('start')} variant="outlined" icon={<LoginOutlined aria-hidden/>} loading={sessionBusy} onClick={()=>void sessionAction(async()=>{const result=await api.server.tailscaleLogin(node);if(result.reason==='alreadyLoggedIn'){useAppStore.getState().setTailscaleLoginState(node.id,true);notifyActionSuccess('login');return;}useAppStore.getState().setTailscaleLoginInitiated(node.id,true);if(result.authUrl)await api.system.openExternal(result.authUrl);},'login')}>{t('common.vocab.signIn')}</Button>{loginInitiated?<Button icon={<CloseOutlined aria-hidden/>} disabled={sessionBusy} onClick={()=>void sessionAction(async()=>{await api.server.tailscaleLoginCancel(node.id);useAppStore.getState().setTailscaleLoginInitiated(node.id,false);notifyActionSuccess('cancel');},'cancel')}>{t('common.actions.cancel')}</Button>:null}<Popconfirm title={t('common.confirm.execute')} description={t('vpn.applyImpact')} onConfirm={()=>sessionAction(async()=>{const result=await api.server.tailscaleLogout(node.id);useAppStore.getState().setTailscaleLoginState(node.id,false);useAppStore.getState().setTailscaleLoginInitiated(node.id,false);if(result.runningNeedsRestart)await useAppStore.getState().refreshPendingChanges();notifyActionSuccess('logout');},'logout')}><Button color="danger" variant="outlined" icon={<LogoutOutlined aria-hidden/>} disabled={sessionBusy}>{t('common.actions.logout')}</Button></Popconfirm></ResponsiveActions>:null}
    {protocol === 'snell' ? <Form.Item label={t('common.vocab.version')}><span>{detected?.snellSettings?.version ?? t('vpn.configurationUnspecified')}</span></Form.Item> : null}
    {protocol === 'wireguard' ? <FormGrid columns={2}><Form.Item label={t('vpn.privateKey')} name={['wireguardSettings','privateKey']}><Input.Password allowClear /></Form.Item><Form.Item label={t('vpn.publicKey')} name={['wireguardSettings','peerPublicKey']}><Input allowClear /></Form.Item></FormGrid> : null}
    {protocol === 'wireguard' ? <Form.Item label={t('vpn.localAddress')} name={['wireguardSettings','localAddress']} rules={[{required:true}]}><MultiSelect allowClear freeInput tokenSeparators={[',',' ']}/></Form.Item> : null}
    <DesktopSection title={t('vpn.rawSettings')} tooltip={t('vpn.rawHint')}><JsonEditor value={raw} onChange={value => setRaw(value ?? '{}')} /></DesktopSection>

  </DrawerForm>;
}
