import { formatDateTime } from '@/utils/dateTime';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { SERVICE_IDS, type UnlockResult, type UnlockStatus } from '@shared/unlock-detection';
import { WEBSITE_CATALOG } from '@shared/website-catalog';
import { useAppStore } from '@/store/app-store';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import { unlockApi, systemApi } from '@/ipc';
import { StatusTag, Stack } from '@/components/client';
import { DesktopSection } from '@/components/vpn/DesktopSection';
import { WEBSITE_ICONS } from './websiteIcons';

/** 品牌图标（inline SVG，无网络依赖——代理不可用时本条目正是故障态，图标不能跟着挂）。 */
function WebsiteIcon({ id, name }: { id: string; name: string }) {
  const spec = WEBSITE_ICONS[id];
  if (!spec) return null;
  return (
    <svg className="service-availability__icon" viewBox="0 0 24 24" role="img" aria-label={name}>
      {spec.path ? (
        <path d={spec.path} fill={spec.color === 'current' ? 'currentColor' : spec.color} />
      ) : null}
      {spec.text ? (
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill={spec.color}
          fontFamily="system-ui, sans-serif"
        >
          {spec.text}
        </text>
      ) : null}
    </svg>
  );
}

/** 展示文案与色调：ok 显示实测延迟（用户读「多快」），其余状态沿用既有限语义。 */
function statusView(
  result: UnlockResult | undefined,
  statuses: Record<UnlockStatus, string>,
  latencyText: string
): { tone: 'success' | 'error' | 'warning' | 'neutral'; text: string } {
  const status = result?.status;
  if (status === 'ok')
    return { tone: 'success', text: result?.latencyMs != null ? latencyText : statuses.ok };
  if (status === 'blocked') return { tone: 'warning', text: statuses.blocked };
  if (status === 'timeout' || status === 'error') return { tone: 'error', text: statuses[status] };
  if (status === 'checking') return { tone: 'neutral', text: statuses.checking };
  return { tone: 'neutral', text: statuses.idle };
}

export function ServiceAvailability() {
  const { t } = useTranslation();
  const snapshot = useAppStore((s) => s.unlock);
  const statuses: Record<UnlockStatus, string> = {
    idle: t('vpn.untested'),
    checking: t('common.loading'),
    ok: t('common.vocab.reachable'),
    partial: t('common.vocab.reachable'),
    blocked: t('vpn.regionRestricted'),
    timeout: t('errors.connectionTimeout'),
    error: t('vpn.networkFailure'),
  };
  return (
    <DesktopSection
      title={t('vpn.services')}
      extra={
        <Button
          icon={<ReloadOutlined aria-hidden />}
          loading={snapshot.running}
          onClick={async () => {
            try {
              useAppStore.getState().beginUnlockCheck();
              const result = await unlockApi.run(true);
              useAppStore.getState().applyUnlockSnapshot(result);
              if (result.checkedAt) notifyActionSuccess('checkConnectivity');
              else notifyActionFailed('checkConnectivity', new Error(t('vpn.networkFailure')));
            } catch (e) {
              notifyActionFailed('checkConnectivity', e);
              useAppStore.getState().resetUnlock();
            }
          }}
        >
          {t('common.actions.reload')}
        </Button>
      }
    >
      <Stack direction="row" wrap gap="control">
        {snapshot.route ? (
          <Typography.Text type="secondary">
            {t(
              snapshot.route === 'direct'
                ? 'vpn.directNetwork'
                : snapshot.route === 'routed'
                  ? 'vpn.currentNetwork'
                  : 'common.vocab.currentNode'
            )}
          </Typography.Text>
        ) : null}
        {snapshot.checkedAt ? (
          <Typography.Text type="secondary">{formatDateTime(snapshot.checkedAt)}</Typography.Text>
        ) : null}
      </Stack>
      {/* 表格感栅格：等宽列、词条左对齐（列首竖直成线），状态值靠右成第二列。 */}
      <div className="service-availability-grid">
        {SERVICE_IDS.map((id) => {
          const result = snapshot.results[id];
          const site = WEBSITE_CATALOG[id];
          const view = statusView(
            result,
            statuses,
            t('vpn.latencyMs', { ms: result?.latencyMs ?? 0 })
          );
          return (
            <div key={id} className="service-availability-item">
              <WebsiteIcon id={id} name={site.name} />
              <Typography.Link
                className="service-availability__name"
                href={site.url}
                onClick={(event) => {
                  event.preventDefault();
                  void systemApi
                    .openExternal(site.url)
                    .catch((error) => notifyActionFailed('openWebsite', error));
                }}
              >
                {site.name}
              </Typography.Link>
              <span className="service-availability__value">
                <StatusTag tone={view.tone}>{view.text}</StatusTag>
              </span>
            </div>
          );
        })}
      </div>
    </DesktopSection>
  );
}
