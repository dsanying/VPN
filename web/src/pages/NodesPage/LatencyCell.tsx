import { useSpeedTestStore } from '@/store/useSpeedTestStore';
import { AtomicValue, Stack, MetadataTag } from '@/components/client';
import { classifySpeedTestFailure, DEFAULT_SPEED_TEST_URL } from '@shared/speed-test';
import { isProbeUnavailable } from '@shared/node-availability';
import {useTranslation} from 'react-i18next';
import {StatusTag} from '@/components/client';
import {useAppStore} from '@/store/app-store';
import {now} from '@/utils/dateTime';
import {deriveLatencyBadge} from '../../../../src/renderer-domain/lib/latency-badge';
import type {ServerConfig} from '@shared/types';
export function LatencyCell({node}:{node:ServerConfig}){
 const {t}=useTranslation();const latency=useAppStore(s=>s.latencyMap[node.id]);const testedAt=useAppStore(s=>s.latencyTestedAt[node.id]);const loggedIn=useAppStore(s=>s.tailscaleLoginStates[node.id]);const running=useAppStore(s=>!!s.connectionStatus?.proxyCore.running);const selected=useAppStore(s=>s.config?.selectedServerId===node.id);const blocked=useAppStore(s=>s.ipInfo?.proxyBlocked);const attempted=useAppStore(s=>s.speedTestAttempted);const notInPool=useAppStore(s=>s.speedTestNotInPool.has(node.id));
 const testing=useSpeedTestStore(s=>s.testing.includes(node.id));
 const detail=useAppStore(s=>s.probeDetails[node.id]);
 const badge=deriveLatencyBadge({server:node,latency,testedAt,now:now().valueOf(),tsLoggedIn:loggedIn,proxyRunning:running,isSelectedExit:selected,proxyBlocked:blocked,speedTestAttempted:attempted,notInPool});
 if(testing)return <AtomicValue text={t('vpn.availability.checking')}/>;
 if(badge.kind==='value')return <Stack direction="row" wrap gap="control"><AtomicValue text={t('vpn.milliseconds',{value:badge.latency})}/>{badge.stale?<MetadataTag>{t('vpn.measurementStale')}</MetadataTag>:null}{detail?.proxyTarget&&detail.proxyTarget!==DEFAULT_SPEED_TEST_URL?<MetadataTag><AtomicValue text={new URL(detail.proxyTarget).hostname}/></MetadataTag>:null}</Stack>;
 if(badge.kind==='timeout')return <AtomicValue text={t(isProbeUnavailable(detail?.proxyReason)?'common.vocab.unconfirmed':detail?.proxyReason&&classifySpeedTestFailure(detail.proxyReason)==='timeout'?'errors.connectionTimeout':'vpn.networkFailure')}/>;
 if(badge.kind==='not-logged-in')return <StatusTag tone="warning">{t('vpn.needsLogin')}</StatusTag>;
 if(badge.kind==='exit-invalid')return <StatusTag tone="error">{t('vpn.exitUnavailable')}</StatusTag>;
 if(badge.kind==='na')return t(badge.reason==='ts-needs-core'?'vpn.needsConnect':'vpn.unsupported');
 return t(badge.reason==='not-in-pool'?'vpn.pending':'vpn.untested');
}

export function EntryLatencyCell({node}:{node:ServerConfig}) {
 const {t}=useTranslation(); const entry=useAppStore(s=>s.probeDetails[node.id]?.entry);
 const testing=useSpeedTestStore(s=>s.testing.includes(node.id));
 const value=!entry?t('vpn.untested'):entry.status==='ok'?t('vpn.milliseconds',{value:entry.latencyMs}):t(entry.status==='unavailable'?'vpn.entryIntercepted':entry.status==='unsupported'?(entry.reason==='NO_TCP_ENTRY'?'vpn.entryNoTcp':entry.reason?'vpn.entryUnsupported':'vpn.untested'):entry.status==='timeout'?'errors.connectionTimeout':'vpn.networkFailure');
 if(testing)return <AtomicValue text={t('vpn.availability.checking')}/>;
 return <AtomicValue text={value}/>;
}
