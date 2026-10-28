import { useShallow } from 'zustand/react/shallow';
import { useSpeedTestStore } from '@/store/useSpeedTestStore';
import { AtomicValue, Stack, MetadataTag } from '@/components/client';
import { classifySpeedTestFailure, DEFAULT_SPEED_TEST_URL } from '@shared/speed-test';
import { isProbeUnavailable } from '@shared/node-availability';
import { useTranslation } from 'react-i18next';
import { StatusTag } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import { now } from '@/utils/dateTime';
import { deriveLatencyBadge, latencyTone } from '@/domain/lib/latency-badge';
import type { ServerConfig } from '@shared/types';
export function LatencyCell({ node, variant }: { node: ServerConfig; variant?: 'card' }) {
  const { t } = useTranslation();
  // 单订阅汇总全部读取：一次浅比较替代十个独立 selector，批测期间每行只判一次状态。
  const { latency, testedAt, loggedIn, running, selected, blocked, attempted, notInPool, detail } =
    useAppStore(
      useShallow((s) => ({
        latency: s.latencyMap[node.id],
        testedAt: s.latencyTestedAt[node.id],
        loggedIn: s.tailscaleLoginStates[node.id],
        running: !!s.connectionStatus?.proxyCore.running,
        selected: s.config?.selectedServerId === node.id,
        blocked: s.ipInfo?.proxyBlocked,
        attempted: s.speedTestAttempted,
        notInPool: s.speedTestNotInPool.has(node.id),
        detail: s.probeDetails[node.id],
      }))
    );
  const testing = useSpeedTestStore((s) => s.proxyPending.includes(node.id));
  const badge = deriveLatencyBadge({
    server: node,
    latency,
    testedAt,
    now: now().valueOf(),
    tsLoggedIn: loggedIn,
    proxyRunning: running,
    isSelectedExit: selected,
    proxyBlocked: blocked,
    speedTestAttempted: attempted,
    notInPool,
  });
  if (node.protocol === 'enterprise')
    return (
      <AtomicValue
        text={testing ? t('vpn.availability.checking') : t('vpn.enterprise.latencyUnsupported')}
      />
    );
  if (testing) return <AtomicValue text={t('vpn.availability.checking')} />;
  if (badge.kind === 'value') {
    const customTarget =
      variant === 'card' && detail?.proxyTarget && detail.proxyTarget !== DEFAULT_SPEED_TEST_URL
        ? new URL(detail.proxyTarget).hostname
        : undefined;
    return (
      <Stack direction="row" wrap gap="control">
        <AtomicValue
          className={
            variant === 'card'
              ? `vpn-node-list__latnum vpn-node-list__latnum--${latencyTone(badge.latency)}`
              : undefined
          }
          title={customTarget}
          text={t('vpn.milliseconds', { value: badge.latency })}
        />
        {badge.stale ? <MetadataTag>{t('vpn.measurementStale')}</MetadataTag> : null}
        {variant !== 'card' && detail?.proxyTarget && detail.proxyTarget !== DEFAULT_SPEED_TEST_URL ? (
          <MetadataTag>
            <AtomicValue text={new URL(detail.proxyTarget).hostname} />
          </MetadataTag>
        ) : null}
      </Stack>
    );
  }
  if (badge.kind === 'timeout')
    return (
      <AtomicValue
        text={t(
          isProbeUnavailable(detail?.proxyReason)
            ? 'common.vocab.unconfirmed'
            : detail?.proxyReason && classifySpeedTestFailure(detail.proxyReason) === 'timeout'
              ? 'errors.connectionTimeout'
              : 'vpn.networkFailure'
        )}
      />
    );
  if (badge.kind === 'not-logged-in')
    return <StatusTag tone="warning">{t('vpn.needsLogin')}</StatusTag>;
  if (badge.kind === 'exit-invalid')
    return <StatusTag tone="error">{t('vpn.exitUnavailable')}</StatusTag>;
  if (badge.kind === 'na')
    return t(badge.reason === 'ts-needs-core' ? 'vpn.needsConnect' : 'vpn.unsupported');
  return t(badge.reason === 'not-in-pool' ? 'vpn.pending' : 'vpn.untested');
}
