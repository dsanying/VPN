import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  SyncOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubscriptionConfig, ServerConfig } from '@shared/types';
import type {
  SubscriptionConnectivity,
  SubscriptionLinkProbe,
} from '@shared/subscription-connectivity';
import { groupServersBySubscription } from '@shared/server-grouping';
import { isSubscriptionNotice } from '@shared/subscription-notice';
import {
  AtomicValue,
  QueryErrorAlert,
  IconButton,
  columnWidth,
  buildTablePagination,
  HelpTip,
  Popconfirm,
  ResponsiveActions,
  Stack,
  Table,
  TablePanel,
} from '@/components/client';
import { SubscriptionQuota } from '@/components/vpn/SubscriptionQuota';
import { api } from '@/ipc';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import {
  formatDate,
  formatDateTimeMinute,
  formatClockMinute,
  formatMonthDayTime,
  now,
  parseServerTime,
} from '@/utils/dateTime';
import { formatNumber } from '@/utils/number';

type GroupRow = { id: string; name: string; count: number; subscription?: SubscriptionConfig };
export function NodeGroupTable({
  servers,
  subscriptions,
  updating,
  refresh,
  edit,
  remove,
  viewNodes,
}: {
  servers: ServerConfig[];
  subscriptions: SubscriptionConfig[];
  updating: string[];
  refresh: (id: string) => void;
  edit: (subscription: SubscriptionConfig) => void;
  remove: (id: string) => Promise<void>;
  viewNodes: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState<string[]>([]);
  const [results, setResults] = useState<
    Record<string, { url: string; value: Partial<SubscriptionConnectivity> }>
  >({});
  const [loadError, setLoadError] = useState<unknown>();
  const [pendingRoutes, setPendingRoutes] = useState<Record<string, string[]>>({});
  const startedRef = useRef<Record<string, number>>({});
  const pendingRef = useRef<Record<string, string[]>>({});
  const busy = useRef(new Set<string>());
  useEffect(() => {
    let disposed = false;
    let eventSeen = false;
    const apply = (records: Record<string, SubscriptionConnectivity>) => {
      if (!disposed) setLoadError(undefined);
      if (!disposed)
        setResults((old) =>
          Object.fromEntries(
            subscriptions.flatMap((sub) =>
              records[sub.id]
                ? [
                    [
                      sub.id,
                      {
                        url: sub.url,
                        value:
                          startedRef.current[sub.id] &&
                          Date.parse(records[sub.id].checkedAt) < startedRef.current[sub.id] &&
                          old[sub.id]?.url === sub.url
                            ? old[sub.id].value
                            : records[sub.id],
                      },
                    ],
                  ]
                : old[sub.id]?.url === sub.url && startedRef.current[sub.id]
                  ? [[sub.id, old[sub.id]]]
                  : []
            )
          )
        );
    };
    const unsubscribe = api.subscription.onMeasurements((records) => {
      eventSeen = true;
      apply(records);
    });
    const offProgress = api.subscription.onProbeProgress((event) => {
      if (
        disposed ||
        !subscriptions.some((sub) => sub.id === event.subscriptionId && sub.url === event.url)
      )
        return;
      eventSeen = true;
      if (event.startedAt !== undefined) startedRef.current[event.subscriptionId] = event.startedAt;
      pendingRef.current = {
        ...pendingRef.current,
        [event.subscriptionId]: event.route
          ? (pendingRef.current[event.subscriptionId] ?? []).filter(
              (route) => route !== event.route
            )
          : ['direct', 'current'],
      };
      setPendingRoutes(pendingRef.current);
      if (event.route && event.probe)
        setResults((old) => ({
          ...old,
          [event.subscriptionId]: {
            url: event.url,
            value: { ...old[event.subscriptionId]?.value, [event.route!]: event.probe },
          },
        }));
    });
    void api.subscription
      .measurements()
      .then((records) => {
        if (!eventSeen) apply(records);
      })
      .catch((error) => {
        if (!disposed) setLoadError(error);
      });
    return () => {
      disposed = true;
      unsubscribe();
      offProgress();
    };
  }, [subscriptions]);

  const groups = groupServersBySubscription(
    servers.filter((server) => !isSubscriptionNotice(server.name)),
    subscriptions,
    { includeEmptySubscriptions: true }
  );
  const subscriptionsById = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription])
  );
  const rows: GroupRow[] = groups.map((group) => ({
    id: group.id,
    name: group.isManual
      ? t('common.vocab.manualNodes')
      : group.isMesh
        ? t('common.vocab.meshNetworking')
        : group.name,
    count: group.servers.length,
    subscription: group.isManual || group.isMesh ? undefined : subscriptionsById.get(group.id),
  }));
  const check = async (subscription: SubscriptionConfig) => {
    if (busy.current.has(subscription.id)) return;
    busy.current.add(subscription.id);
    setChecking((old) => [...old, subscription.id]);
    pendingRef.current = { ...pendingRef.current, [subscription.id]: ['direct', 'current'] };
    setPendingRoutes(pendingRef.current);
    try {
      const value = await api.subscription.checkConnectivity(subscription.id);
      setResults((old) => ({ ...old, [subscription.id]: { url: subscription.url, value } }));
      notifyActionSuccess('checkConnectivity');
    } catch (error) {
      notifyActionFailed('checkConnectivity', error);
    } finally {
      pendingRef.current = { ...pendingRef.current, [subscription.id]: [] };
      setPendingRoutes(pendingRef.current);
      busy.current.delete(subscription.id);
      setChecking((old) => old.filter((id) => id !== subscription.id));
    }
  };
  const probeText = (probe?: SubscriptionLinkProbe) => {
    if (!probe) return t('vpn.untested');
    if (probe.status === 'reachable') return t('vpn.linkReachable', { status: probe.httpStatus });
    if (probe.status === 'http-error') return t('vpn.linkHttpError', { status: probe.httpStatus });
    if (probe.status === 'timeout') return t('errors.connectionTimeout');
    if (probe.status === 'unavailable') return t('common.vocab.directRouteUnavailable');
    return t('vpn.networkFailure');
  };
  const title = (label: string, hint: string) => (
    <Stack direction="row" gap="control">
      <span>{label}</span>
      <HelpTip title={hint} />
    </Stack>
  );
  return (
    <Stack direction="column" gap="block">
      {loadError ? (
        <QueryErrorAlert
          error={loadError}
          errorTitle={t('errors.configNotLoaded')}
          retryLabel={t('common.actions.retry')}
          onRetry={() =>
            void api.subscription
              .measurements()
              .then((records) => {
                setLoadError(undefined);
                setResults(
                  Object.fromEntries(
                    subscriptions.flatMap((sub) =>
                      records[sub.id] ? [[sub.id, { url: sub.url, value: records[sub.id] }]] : []
                    )
                  )
                );
              })
              .catch(setLoadError)
          }
        />
      ) : null}
      <TablePanel>
        <Table<GroupRow>
          rowKey="id"
          orderBy={(row) => row.name}
          dataSource={rows}
          pagination={buildTablePagination()}
          columns={[
            {
              title: t('common.vocab.name'),
              key: 'name',
              render: (_, row) => (
                <Stack direction="column" gap="control">
                  <AtomicValue text={row.name} />
                  {row.subscription?.lastUpdated ? (
                    <span>
                      {t('common.actions.update')}:{' '}
                      {parseServerTime(row.subscription.lastUpdated).isSame(now(), 'day')
                        ? formatClockMinute(row.subscription.lastUpdated)
                        : formatMonthDayTime(row.subscription.lastUpdated)}
                    </span>
                  ) : null}
                  {row.subscription?.userInfo?.expire ? (
                    <span>
                      {t('vpn.expiry')}: {formatDate(row.subscription.userInfo.expire * 1000)}
                    </span>
                  ) : null}
                </Stack>
              ),
            },
            {
              title: t('common.vocab.nodes'),
              key: 'count',
              width: columnWidth.id,
              render: (_, row) => <AtomicValue text={formatNumber(row.count)} />,
            },
            {
              title: t('vpn.groupQuota'),
              key: 'quota',
              width: columnWidth.text,
              render: (_, row) =>
                row.subscription ? (
                  <Stack direction="column" gap="control">
                    <SubscriptionQuota info={row.subscription.userInfo} />
                    {row.subscription.userInfo?.balance !== undefined ? (
                      <span>
                        {t('common.vocab.balance')}:{' '}
                        {formatNumber(row.subscription.userInfo.balance)}{' '}
                        {row.subscription.userInfo.currency}
                      </span>
                    ) : null}
                    {!row.subscription.userInfo ? t('vpn.quotaNotProvided') : null}
                  </Stack>
                ) : (
                  t('vpn.notApplicable')
                ),
            },
            {
              title: t('common.vocab.connectivity'),
              key: 'connectivity',
              width: columnWidth.code,
              render: (_, row) => {
                if (!row.subscription) return t('vpn.notApplicable');
                const result = results[row.id];
                const value = result?.url === row.subscription.url ? result.value : undefined;
                return (
                  <Stack direction="column" gap="control">
                    {(['direct', 'current'] as const).map((path) => (
                      <Stack direction="column" gap="tight" key={path}>
                        {title(
                          t(path === 'direct' ? 'vpn.linkDirect' : 'common.vocab.currentNetwork'),
                          t(path === 'direct' ? 'vpn.linkDirectHint' : 'vpn.linkCurrentHint')
                        )}
                        <AtomicValue
                          text={
                            pendingRoutes[row.id]?.includes(path)
                              ? t('vpn.availability.checking')
                              : probeText(value?.[path])
                          }
                        />
                      </Stack>
                    ))}
                    {value?.checkedAt ? <span>{formatDateTimeMinute(value.checkedAt)}</span> : null}
                  </Stack>
                );
              },
            },
            {
              title: t('common.vocab.operations'),
              key: 'action',
              width: columnWidth.actions(1, 4),
              render: (_, row) =>
                row.subscription ? (
                  <ResponsiveActions>
                    <Button icon={<EyeOutlined aria-hidden />} onClick={() => viewNodes(row.id)}>
                      {t('common.actions.view')}
                    </Button>
                    <IconButton
                      icon={<LinkOutlined aria-hidden />}
                      label={t('vpn.linkCheck')}
                      loading={checking.includes(row.id)}
                      onClick={() => void check(row.subscription!)}
                    />
                    <IconButton
                      icon={<SyncOutlined aria-hidden />}
                      label={t('common.actions.sync')}
                      loading={updating.includes(row.id)}
                      onClick={() => refresh(row.id)}
                    />
                    <IconButton
                      icon={<EditOutlined aria-hidden />}
                      label={t('common.actions.edit')}
                      onClick={() => edit(row.subscription!)}
                    />
                    <Popconfirm
                      title={t('common.confirm.execute')}
                      description={t('vpn.deleteGroupImpact', { name: row.name, count: row.count })}
                      onConfirm={() => remove(row.id)}
                    >
                      <IconButton
                        icon={<DeleteOutlined aria-hidden />}
                        label={t('common.actions.delete')}
                        color="danger"
                        variant="outlined"
                      />
                    </Popconfirm>
                  </ResponsiveActions>
                ) : (
                  <Button icon={<EyeOutlined aria-hidden />} onClick={() => viewNodes(row.id)}>
                    {t('common.actions.view')}
                  </Button>
                ),
            },
          ]}
        />
      </TablePanel>
    </Stack>
  );
}
