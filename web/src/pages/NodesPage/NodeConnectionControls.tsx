import { useMemo } from 'react';
import { ServerSelect } from '@/components/vpn/ServerSelect';
import { actionColor } from '@/config/theme';
import {tFragment} from '@/i18n';
import {isSubscriptionNotice} from '@shared/subscription-notice';
import { PoweroffOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form } from 'antd';
import { useTranslation } from 'react-i18next';
import { Stack, ViewSwitch, ResponsiveActions, Popconfirm } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import type { ProxyMode } from '@shared/types';
import { patchConfig } from '@/store/config-mutations';
import { api } from '@/ipc';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { isServerComplete } from '@shared/server-completeness';
import { meshNodeCarriesFullTunnel } from '@shared/endpoint-routes';
export function NodeConnectionControls({ onAddSubscription }: { onAddSubscription: () => void }) {
  const config = useAppStore(s => s.config);
  const running = useAppStore(s => s.connectionStatus?.proxyCore.running ?? false);
  const busy = useAppStore(s => s.proxyBusy);
  const phase = useAppStore(s => s.proxyPhase);
  const disconnectAction = phase === 'stopping' || (phase !== 'starting' && running);
  const pending = useAppStore(s => s.pendingChanges);
  const start = useAppStore(s => s.startProxy);
  const stop = useAppStore(s => s.stopProxy);
  const { t } = useTranslation();
  const choices = useMemo(() => config?.servers.filter(n => !isSubscriptionNotice(n.name) && isServerComplete(n) && meshNodeCarriesFullTunnel(n)) ?? [], [config?.servers]);
  const change = async (patch: Partial<NonNullable<typeof config>>) => {
    if (!config) return;
    try { await patchConfig(current => ({ ...current, ...patch }));notifyActionSuccess('save'); } catch (e) { notifyActionFailed('save', e); }
  };
  return <><Card size="small"><Stack direction="row" align="center" wrap gap="control">
    {choices.length ? <Form layout="inline" className="ds-inline-control-form"><Form.Item label={t('common.vocab.nodes')}><ServerSelect aria-label={t('common.vocab.nodes')} value={config?.selectedServerId} servers={choices} subscriptions={config?.subscriptions} onChange={id => void change({ selectedServerId: id ?? null })} /></Form.Item></Form> : <Alert title={t('vpn.noNodes')} type="info" />}
    <ResponsiveActions justify="start"><Button color={disconnectAction ? actionColor('stop') : actionColor('start')} variant="outlined" icon={<PoweroffOutlined aria-hidden/>} loading={busy} disabled={!disconnectAction && !config?.selectedServerId} onClick={() => void (disconnectAction ? stop() : start())}>{t(phase === 'starting' ? 'common.vocab.connecting' : phase === 'stopping' ? 'vpn.disconnecting' : disconnectAction ? 'common.vocab.disconnect' : 'common.vocab.connect')}</Button>{!choices.length?<Button icon={<PlusOutlined aria-hidden/>} onClick={() => onAddSubscription()}>{t('common.actionObjectTemplates.add',{object:tFragment('common.vocab.subscription')})}</Button>:null}</ResponsiveActions>
  </Stack></Card>

  {pending.added.length || pending.modified.length ? <Alert showIcon type="warning" title={t('vpn.pending')} action={<Popconfirm title={t('common.confirm.execute')} description={t('vpn.applyImpact')} onConfirm={async () => {try{if(!(await api.proxy.applyPendingChanges()).ok)throw new Error(t('common.requestFailed'));await useAppStore.getState().refreshPendingChanges();notifyActionSuccess('apply');}catch(e){notifyActionFailed('save',e);}}}><Button icon={<ReloadOutlined aria-hidden/>}>{t('common.vocab.apply')}</Button></Popconfirm>} /> : null}
  </>;
}

export function NodeRoutingControl() {
 const config = useAppStore(s => s.config); const {t}=useTranslation();
 return <ViewSwitch<ProxyMode> value={config?.proxyMode} onChange={async value=>{try{await patchConfig(current=>({...current,proxyMode:value}));notifyActionSuccess('save');}catch(e){notifyActionFailed('save',e);}}} options={[{value:'smart',label:t('common.vocab.smartRouting')},{value:'global',label:t('common.vocab.globalProxy')},{value:'direct',label:t('common.vocab.direct')}]}/>;
}
