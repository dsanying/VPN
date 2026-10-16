import { ENTERPRISE_NAMES, type EnterpriseAuthField, type EnterpriseProfile } from '@shared/enterprise-vpn';
import { actionColor } from '@/config/theme';
import { DesktopSection } from '@/components/vpn/DesktopSection';
import {networkLabels} from '@/i18n/vpnLabels';
import { Button, Form, Input, InputNumber, Select } from 'antd';
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
  const [source, setSource] = useState(node?.enterpriseSettings?.gateway ?? '');
  const [sourceChanged, setSourceChanged] = useState(false);
  const [authFields, setAuthFields] = useState<EnterpriseAuthField[]>([]);
  const [profile, setProfile] = useState<EnterpriseProfile>();
  useEffect(() => {
    const selections = { ...form.getFieldValue('selections') };
    for (const field of authFields) {
      if (!field.choices?.length) continue;
      if (field.choices.length === 1) selections[field.name] = field.choices[0].value;
      else if (!field.choices.some(choice => choice.value === selections[field.name])) delete selections[field.name];
    }
    form.setFieldValue('selections', selections);
  }, [authFields, form]);
  useEffect(() => { if (node?.enterpriseSettings) void api.enterprise.get().then(snapshot => { const value = snapshot.profiles.find(p => p.id === node.enterpriseSettings?.profileId); setProfile(value); form.setFieldsValue({username:value?.username,selections:value?.selections}); if (value) void api.enterprise.detect(value.gateway).then(d => setAuthFields(d.fields ?? []), e => notifyActionFailed('sync',e)); }, e => notifyActionFailed('sync',e)); }, [node,form]);
  const [detected, setDetected] = useState<ServerConfig | undefined>(node);
  const protocol = detected?.protocol;
  const network = detected?.network;
  const security = detected?.security;
  const [detecting, setDetecting] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  useEffect(() => {
    if (!sourceChanged || !source.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        if (/^https:\/\//i.test(source.trim()) || /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/[^?#]*)?$/i.test(source.trim())) {
          const gateway = await api.enterprise.detect(source.trim());
          if (!gateway.protocol) throw new Error(gateway.reason ?? t('vpn.enterprise.unrecognized'));
          if (current) setAuthFields(gateway.fields ?? []);
          const url = new URL(gateway.gateway);
          const resolved = {id:node?.id ?? crypto.randomUUID(),name:node?.name ?? url.hostname, protocol:'enterprise' as const,address:url.hostname,port:Number(url.port || 443),enterpriseSettings:{profileId:node?.enterpriseSettings?.profileId ?? '',gateway:gateway.gateway,client:gateway.protocol}};
          return {nodes:[resolved],subscriptions:[],stats:{failed:0,skipped:0}};
        }
        return api.localImport.parse(source);
      })().then(result => {
        if (!current) return;
        if (result.nodes.length !== 1 || result.subscriptions.length || result.stats.failed || result.stats.skipped) {
          setDetected(undefined); setSourceError(true); return;
        }
        const resolved = result.nodes[0];
        setDetected(resolved);
        setRaw(formatJson(resolved) ?? '{}');
        const name = form.getFieldValue('name');
        const identityUnchanged = resolved.enterpriseSettings?.gateway === node?.enterpriseSettings?.gateway;
        const credentials = identityUnchanged ? { username: form.getFieldValue('username'), selections: form.getFieldValue('selections'), password: form.getFieldValue('password') } : {};
        form.resetFields();
        form.setFieldsValue({ ...resolved, ...credentials, name: name || resolved.name });
      }, () => { if (current) { setDetected(undefined); setSourceError(true); } }).finally(() => { if (current) setDetecting(false); });
    }, 400);
    return () => { current = false; clearTimeout(timer); };
  }, [source, sourceChanged, form, node, t]);
  const [sessionBusy,setSessionBusy]=useState(false);
  const loginInitiated=useAppStore(s=>node?s.tailscaleLoginInitiated[node.id]:false);
  const sessionAction=async(action:()=>Promise<void>,feedback:'login'|'cancel'|'logout')=>{setSessionBusy(true);try{await action();}catch(e){notifyActionFailed(feedback,e);}finally{setSessionBusy(false);}};
  return <DrawerForm<Partial<ServerConfig> & {selections?:Record<string,string>}> form={form} open title={t('common.vocab.nodes')} onOpenChange={open => { if (!open) onClose(); }} initialValues={{ ...node }} onFinish={async values => {
    try {
      if ((protocol === 'enterprise' && !source.trim()) || detecting || sourceError || (!node && !detected) || (source.trim() && !detected)) { setSourceError(true); throw new Error(t('vpn.nodeSourceInvalid')); }
      if (protocol === 'enterprise' && detected?.enterpriseSettings) {
        await api.enterprise.save({id:node?.enterpriseSettings?.profileId,name:values.name,gateway:detected.enterpriseSettings.gateway,username:values.username,password:values.password,selections:values.selections});
        await useAppStore.getState().loadConfig(); notifyActionSuccess('save'); return true;
      }
      const draft = mergeNodeDraft(node, values, parseJsonText(raw));
      if (!isServerComplete(draft)) throw new Error(t('vpn.validationRequired'));
      if (node) await api.server.update(draft); else await api.server.add(draft);
      await useAppStore.getState().loadConfig(); notifyActionSuccess('save'); return true;
    } catch (e) { notifyActionFailed('save',e);return false; }
  }}>
    <Form.Item label={t('common.vocab.name')} name="name" rules={[{required:true,whitespace:true}]}><Input allowClear /></Form.Item>
    <Form.Item label={t('vpn.nodeSource')} tooltip={t('vpn.nodeSourceHint')} validateStatus={sourceError ? 'error' : undefined} help={sourceError ? t('vpn.nodeSourceInvalid') : undefined}><Input.TextArea aria-label={t('vpn.nodeSource')} value={source} rows={2} onChange={event => {
      setSourceChanged(true); setSource(event.target.value); setDetecting(Boolean(event.target.value.trim())); setSourceError(false);
      if (!event.target.value.trim()) { setDetecting(false); setSourceError(false); setDetected(node); setRaw(formatJson(node ?? {}) ?? '{}'); form.resetFields(); }
    }} /></Form.Item>
    {detecting ? <span role="status">{t('vpn.detectingConfiguration')}</span> : null}
    <Form.Item label={t('common.vocab.protocol')} tooltip={t('vpn.automaticSourceHint')}><span role="status">{protocol === 'enterprise' && detected?.enterpriseSettings ? ENTERPRISE_NAMES[detected.enterpriseSettings.client] : protocol?.toUpperCase() ?? t('vpn.awaitingSource')}</span></Form.Item>
    {protocol && protocol !== 'tailscale' && protocol !== 'custom' && protocol !== 'enterprise' ? <FormGrid columns={2}><Form.Item label={t('common.vocab.address')} name="address" rules={[{required:true,whitespace:true}]}><Input allowClear /></Form.Item><Form.Item label={t('common.vocab.port')} name="port" rules={[{required:true}]}><InputNumber min={1} max={65535} /></Form.Item></FormGrid> : null}
    {protocol === 'enterprise' ? <>{authFields.filter(field => (field.choices?.length ?? 0) > 1).map(field => <Form.Item key={field.name} name={['selections',field.name]} label={field.name === 'authentication' ? t('vpn.enterprise.authenticationMethod') : field.label} tooltip={t('vpn.enterprise.selectionHint')} rules={[{required:true}]} initialValue={field.choices?.length === 1 ? field.choices[0].value : undefined}><Select options={field.choices} /></Form.Item>)}<Form.Item label={t('vpn.enterprise.username')} tooltip={t('vpn.enterprise.usernameHint')} name="username"><Input allowClear autoComplete="username" /></Form.Item><Form.Item label={t('vpn.enterprise.password')} tooltip={t(profile?.hasPassword ? 'vpn.enterprise.savedPasswordHint' : 'vpn.enterprise.passwordHint')} name="password"><Input.Password autoComplete="new-password" /></Form.Item></> : null}
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
    {protocol !== 'enterprise' ? <DesktopSection title={t('vpn.rawSettings')} tooltip={t('vpn.rawHint')}><JsonEditor value={raw} onChange={value => setRaw(value ?? '{}')} /></DesktopSection> : null}

  </DrawerForm>;
}
