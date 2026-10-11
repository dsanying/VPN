import { useSpeedTestStore } from '@/store/useSpeedTestStore';
import {nodeAvailabilityLabel} from './nodeAvailabilityLabel';
import {useMeasurementClock} from './useMeasurementClock';
import {useTranslation} from 'react-i18next';
import {cachedNodeAvailability} from './cachedNodeAvailability';
import {useAppStore} from '@/store/app-store';
import {StatusTag, HelpTip} from '@/components/client';
import {formatDateTime, now} from '@/utils/dateTime';

export function NodeAvailability({nodeId}:{nodeId:string}) {
 const {t}=useTranslation(); const time=useMeasurementClock();
 const testing=useSpeedTestStore(s=>s.testing.includes(nodeId));
 const measured=useAppStore(s=>s.latencyTestedAt[nodeId]);
 const state=useAppStore(s=>cachedNodeAvailability(s,nodeId,Math.max(time,now().valueOf())));
 const tag=<StatusTag tone={testing?'info':state==='available'?'success':state==='failed'?'error':state==='stale'||state==='unknown'?'warning':'neutral'}>{testing?t('vpn.availability.checking'):nodeAvailabilityLabel(state,t)}</StatusTag>;
 return measured&&!testing?<HelpTip title={formatDateTime(measured)}>{tag}</HelpTip>:tag;
}
