import { formatDateTime } from '@/utils/dateTime';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { SERVICE_IDS, type UnlockStatus } from '@shared/unlock-detection';
import { WEBSITE_CATALOG } from '@shared/website-catalog';
import { useAppStore } from '@/store/app-store';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { unlockApi, systemApi } from '@/ipc';
import { InformationFieldGrid, StatusTag, Stack, AtomicValue } from '@/components/client';
import { DesktopSection } from '@/components/vpn/DesktopSection';
export function ServiceAvailability(){
 const {t}=useTranslation(); const snapshot=useAppStore(s=>s.unlock);
 const statuses:Record<UnlockStatus,string>={idle:t('vpn.untested'),checking:t('common.loading'),ok:t('common.vocab.reachable'),partial:t('common.vocab.reachable'),blocked:t('vpn.regionRestricted'),timeout:t('errors.connectionTimeout'),error:t('vpn.networkFailure')};
 return <DesktopSection title={t('vpn.services')} extra={<Button icon={<ReloadOutlined aria-hidden/>} loading={snapshot.running} onClick={async()=>{try{useAppStore.getState().beginUnlockCheck();const result = await unlockApi.run(true);useAppStore.getState().applyUnlockSnapshot(result);if(result.checkedAt)notifyActionSuccess('checkConnectivity');else notifyActionFailed('checkConnectivity',new Error(t('vpn.networkFailure')));}catch(e){notifyActionFailed('checkConnectivity',e);useAppStore.getState().resetUnlock();}}}>{t('common.actions.reload')}</Button>}>
   <Stack direction="row" wrap gap="control">{snapshot.route ? <Typography.Text type="secondary">{t(snapshot.route==='direct'?'vpn.directNetwork':snapshot.route==='routed'?'vpn.currentNetwork':'common.vocab.currentNode')}</Typography.Text> : null}
   {snapshot.checkedAt ? <Typography.Text type="secondary">{formatDateTime(snapshot.checkedAt)}</Typography.Text> : null}</Stack>
   <InformationFieldGrid items={SERVICE_IDS.map(id=>{const result=snapshot.results[id];const site=WEBSITE_CATALOG[id];return {key:id,label:<Typography.Link href={site.url} onClick={event=>{event.preventDefault();void systemApi.openExternal(site.url).catch(error=>notifyActionFailed('openWebsite',error));}}>{site.name}</Typography.Link>,value:<Stack direction="row" gap="control"><StatusTag tone={result?.status==='ok'?'success':result?.status==='blocked'?'warning':result?.status==='error'||result?.status==='timeout'?'error':'neutral'}>{statuses[result?.status??'idle']}</StatusTag>{result?.httpStatus?<AtomicValue text={t('vpn.responseStatus',{code:result.httpStatus})}/>:null}</Stack>};})}/>
 </DesktopSection>;
}
