import { dueMeasurementScope } from '@shared/measurement-refresh-scope';
import { ConfigRepository, type ConfigDocumentStore } from '@shared/config-repository';
import { PortableConfigOperations } from '@shared/portable-config-operations';
import { PortableClientService } from '@shared/portable-client-service';
import { PortableSubscriptionManager } from '@shared/portable-subscription-manager';
import { PortableSubscriptionMeasurements } from '@shared/portable-subscription-measurements';
import { PortableNodeMeasurements } from '@shared/portable-node-measurements';
import { PortableRefreshCoordinator } from '@shared/portable-refresh-coordinator';
import { PortableLiveStreams } from '@shared/portable-live-streams';
import { PortableLogRepository } from '@shared/portable-log-repository';
import { PortableWebsiteMeasurements } from '@shared/portable-website-measurements';
import { portableSha256 } from '@shared/portable-subscription-measurements';
import { PortableBackups } from '@shared/portable-backups';
import { PortableDiagnostics } from '@shared/portable-diagnostics';
import { PortableIpInfo } from '@shared/portable-ip-info';
import { buildAndroidNodeProbeConfig } from '@shared/android-node-probe-config';
import { isDirectSelection } from '@shared/direct-selection';
import { PortableReleaseChecks } from '@shared/portable-release-checks';
import { MaintenanceCycle } from '@shared/maintenance-cycle';
import { createHostTextRequester, isRetryableHostTextError } from '@shared/host-text-request';
import { requestSubscription } from '@shared/subscription-request';
import { IPC_CHANNELS as C } from '@shared/ipc-channels';
import type { LogEntry, LogLevel } from '@shared/types';
import { androidConfigRepository } from './config-repository';
import type { ShadowVpnNative } from './native-contract';
import { createAndroidCoreController } from './core-controller';
import { createAndroidNodeProbe } from './node-probe';
import { MobileClientTransport } from './client-transport';

/** Assemble real portable services before the renderer subscribes or reads configuration. */
export async function createMobileServiceRuntime(
  native: ShadowVpnNative,
  host: { foreground?: boolean; now?: () => number } = {}
) {
  const store: ConfigDocumentStore = {
    read: async (name) => (await native.readState({ name })).content,
    write: async (name, content) => {
      await native.writeState({ name, content });
    },
  };
  const config: ConfigRepository = androidConfigRepository(native);
  const capabilities = await native.capabilities();
  const prepareHost = async () => ({ applicationRouting: capabilities.connectionOwner });
  const core = createAndroidCoreController(
    config,
    async (saved) => {
      const host = await prepareHost();
      if (saved.proxyMode !== 'smart') return host;
      const info = await ips.ensureCurrent();
      const country = info.direct?.countryCode;
      if (!country) throw new Error('无法确认当前网络地区，请检查网络后重试');
      return { ...host, localRegionRuleSet: await native.prepareCountryRuleSet({ country }) };
    },
    native
  );
  const requestText = createHostTextRequester(native);
  const ips = new PortableIpInfo(
    store,
    {
      identity: async () => {
        const saved = await config.read();
        const state = core.snapshot();
        return {
          key: await portableSha256(
            JSON.stringify([
              saved.selectedServerId,
              saved.servers,
              saved.dnsConfig,
              saved.enableIPv6,
              state.running,
              state.startTime,
              (await native.networkContext()).identity,
            ])
          ),
          proxy:
            state.running && !!saved.selectedServerId && !isDirectSelection(saved.selectedServerId),
        };
      },
      trace: async (route, target, signal) => {
        if (route === 'direct') return requestText(target, 'direct', signal, 'ShadowVPN');
        const saved = await config.read();
        const node = saved.servers.find((item) => item.id === saved.selectedServerId);
        if (!node) throw new Error('未选择有效出口');
        const environment = await native.coreEnvironment();
        const compiled = buildAndroidNodeProbeConfig(node, saved, {
          ...(await prepareHost()),
          stateDirectory: environment.stateDirectory,
        });
        const id = crypto.randomUUID();
        const cancel = () => {
          void native.cancelProbe({ id }).catch(() => undefined);
        };
        signal.throwIfAborted();
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await native.measureNode({
            id,
            ...compiled,
            target,
            address: node.address,
            port: node.port,
          });
          signal.throwIfAborted();
          return { status: result.status ?? 0, body: result.body ?? '' };
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      },
    },
    (value) => service?.emit(C.EVENT_IP_INFO_UPDATED, value)
  );
  const logs = new PortableLogRepository(store);
  const report = (operation: string) => {
    void logs
      .append([
        {
          timestamp: new Date().toISOString(),
          level: 'error',
          source: '移动客户端',
          message: `${operation}失败`,
        },
      ])
      .then((entries) => service?.emit(C.EVENT_LOG_RECEIVED_BATCH, entries))
      .catch(() => undefined);
  };
  const links = new PortableSubscriptionMeasurements(config, store, native, (records) =>
    service?.emit(C.EVENT_SUBSCRIPTION_MEASUREMENTS, records)
  );
  const nodes = new PortableNodeMeasurements(
    config,
    store,
    createAndroidNodeProbe(config, prepareHost, native),
    {
      progress: (value) => service?.emit(C.EVENT_SPEED_TEST_PROGRESS, value),
      result: (serverId, value) => {
        service?.emit(C.EVENT_SPEED_TEST_RESULT, { serverId, latency: value.latency });
        service?.emit(C.EVENT_SPEED_TEST_DETAILS, { serverId, detail: value.detail });
      },
    }
  );
  const subscriptions = new PortableSubscriptionManager(
    config,
    native,
    async () => core.snapshot().running,
    async (id, restartRequired) => {
      refresh.subscriptionCommitted(id, restartRequired);
    }
  );
  const operations = new PortableConfigOperations(config, {
    saved: async (previous, next) => {
      refresh.saved(previous, next);
    },
    removeServer: async () => {
      await nodes.read();
    },
    removeSubscription: (id) => {
      subscriptions.cancel(id);
      links.cancel(id);
    },
  });
  const refresh = new PortableRefreshCoordinator(config, {
    sync: (id) => subscriptions.sync(id),
    connectivity: (id) => links.check(id),
    measure: (ids) => nodes.test(ids),
    applySaved: () => core.applySaved(),
    cleanup: () => Promise.all([nodes.read(), links.read()]),
    error: (operation) => report(operation),
  });
  const live = new PortableLiveStreams({
    subscribe: (topics) => native.subscribeCoreEvents({ topics }),
    emit: (channel, data) => service?.emit(channel, data),
    running: () => core.snapshot().running,
    applications: async () => (await native.listApplications()).applications,
  });
  const websites = new PortableWebsiteMeasurements(
    store,
    native,
    async () => {
      const state = core.snapshot();
      const saved = await config.read();
      return {
        identity: await portableSha256(
          JSON.stringify([
            state.running,
            state.startTime ?? null,
            saved.proxyMode,
            saved.selectedServerId,
            saved.servers,
            saved.customRules,
            saved.dnsConfig,
            saved.enableIPv6,
            saved.mixedPort,
            saved.allowLan,
            (await native.networkContext()).identity,
          ])
        ),
        route: state.running ? 'routed' : 'direct',
      };
    },
    (snapshot) => service?.emit(C.EVENT_UNLOCK_UPDATED, snapshot)
  );
  let networkIdentity = JSON.stringify([core.snapshot().running, core.snapshot().startTime]);
  const offState = core.subscribe((state) => {
    live.stateChanged();
    const next = JSON.stringify([state.running, state.startTime]);
    if (next !== networkIdentity) {
      networkIdentity = next;
      websites.invalidate();
      void ips.refresh().catch(() => report('出口检测'));
    }
  });
  let ipConfigIdentity = '';
  const offConfig = config.subscribe((saved) => {
    websites.invalidate();
    const next = JSON.stringify([
      saved.selectedServerId,
      saved.servers,
      saved.dnsConfig,
      saved.enableIPv6,
    ]);
    if (ipConfigIdentity && next !== ipConfigIdentity)
      void ips.refresh().catch(() => report('出口检测'));
    ipConfigIdentity = next;
  });
  const updates = new PortableReleaseChecks({
    store,
    read: async (url, _accept, signal) =>
      requestSubscription(
        'auto',
        () => true,
        (current) => requestText(url, current ? 'current' : 'direct', signal, 'ShadowVPN'),
        isRetryableHostTextError
      ),
    version: () => native.clientInfo(),
    prepare: (options) => native.prepareSoftwareUpdate(options),
    install: () => native.installSoftwareUpdate(),
    restored: async () => (await native.preparedSoftwareUpdate()).update,
    changed: (snapshot) => service?.emit(C.EVENT_UPDATE_PROGRESS, { globalUpdates: snapshot }),
  });
  const backups = new PortableBackups(config, operations, native);
  const diagnostics = new PortableDiagnostics(config, core, logs, native);
  const service = new PortableClientService({
    config,
    operations,
    core,
    subscriptions,
    links,
    preview: (url) => subscriptions.preview(url),
    applications: async () => (await native.listApplications()).applications,
    nodeMeasurements: () => nodes.read(),
    speedTest: (ids) => nodes.test(ids),
    version: () => native.clientInfo(),
    logs: () => logs.read(),
    commands: new Map<string, (args: unknown) => Promise<unknown>>([
      [
        C.UPDATE_CHECK,
        async (args: unknown) =>
          (args as { statusOnly?: boolean })?.statusOnly ? updates.savedStatus() : updates.check(),
      ],
      [
        C.UPDATE_INSTALL,
        async (args: unknown) => updates.install((args as { kind?: unknown })?.kind),
      ],
      [
        C.STATS_SUBSCRIBE,
        async (args: unknown) =>
          live.subscription(
            (args as { topic?: unknown })?.topic,
            true,
            (args as { viewOwner?: string })?.viewOwner
          ),
      ],
      [
        C.STATS_UNSUBSCRIBE,
        async (args: unknown) =>
          live.subscription(
            (args as { topic?: unknown })?.topic,
            false,
            (args as { viewOwner?: string })?.viewOwner
          ),
      ],
      [
        C.CONNECTIONS_CLOSE,
        async (args: unknown) => native.closeConnections({ id: (args as { id?: string })?.id }),
      ],
      [C.CONNECTIONS_CLOSE_ALL, async () => native.closeConnections({})],
      [
        C.BACKUP_EXPORT,
        async (args) =>
          backups.export(
            (args as { categories?: import('@shared/backup-categories').BackupCategory[] })
              ?.categories
          ),
      ],
      [C.BACKUP_IMPORT_PICK, () => backups.pick()],
      [
        C.BACKUP_IMPORT_APPLY,
        async (args) =>
          backups.apply(
            (args as { filePath?: unknown })?.filePath,
            (args as { categories?: unknown })?.categories
          ),
      ],
      [C.BACKUP_GET_INFO, () => backups.info()],
      [C.SHELL_OPEN_EXTERNAL, async (args) => native.openExternal({ url: args as string })],
      [C.SYSTEM_VPN_SETTINGS, () => native.openVpnSettings()],
      [C.DIAGNOSTIC_EXPORT, () => diagnostics.export()],
      [
        C.IP_INFO_GET,
        async (args) => {
          if ((args as { force?: boolean })?.force) await ips.refresh();
          return ips.read();
        },
      ],
      [C.UNLOCK_GET, () => websites.read()],
      [C.UNLOCK_RUN, () => websites.run()],
    ]),
    clearLogs: async () => {
      await native.clearLogs();
      await logs.clear();
    },
  });
  let closed = false;
  let detach: (() => Promise<void>) | undefined;
  let detachNetwork: (() => Promise<void>) | undefined;
  try {
    await service.initialize();
    const initial = await config.read();
    if (host.foreground !== false && initial.autoConnect && !core.snapshot().running) {
      // A saved launch preference invokes the real VPN consent/start path once, never from a page mount.
      void core.start().catch(() => report('启动连接'));
    }
    // Saved results are reconciled here; opening a page never initiates a network probe.
    const [savedNodes, savedLinks] = await Promise.all([nodes.read(), links.read(), logs.read()]);
    refresh.request(dueMeasurementScope(initial, savedNodes, savedLinks, host.now?.()));
    const listener = await native.addListener('coreEvent', (event) => {
      if (closed) return;
      live.event(event.topic, event.data);
      if (event.topic !== 'logs' || !Array.isArray(event.data)) return;
      const levels: LogLevel[] = ['fatal', 'fatal', 'error', 'warn', 'info', 'debug', 'debug'];
      const timestamp = new Date().toISOString();
      const entries: LogEntry[] = event.data
        .filter((item) => item && Number.isInteger(item.level) && typeof item.message === 'string')
        .map((item) => ({
          timestamp,
          level: levels[item.level] ?? 'debug',
          source: '内核',
          message: item.message,
        }));
      if (entries.length)
        void logs
          .append(entries)
          .then((saved) => service.emit(C.EVENT_LOG_RECEIVED_BATCH, saved))
          .catch(() => report('日志保存'));
    });
    detach = () => listener.remove();
    let previousNetwork = (await native.networkContext()).identity;
    const networkListener = await native.addListener('networkChanged', (state) => {
      if (closed || state.identity === previousNetwork) return;
      previousNetwork = state.identity;
      void ips
        .refresh()
        .then(async () => {
          if (!closed && core.snapshot().running && (await config.read()).proxyMode === 'smart')
            await core.applySaved();
        })
        .catch(() => report('网络切换'));
    });
    detachNetwork = () => networkListener.remove();
    await native.subscribeCoreEvents({ topics: ['logs'] });
    void ips.ensureCurrent().catch(() => report('出口检测'));
    void websites.ensureCurrent().catch(() => report('网站检测'));
  } catch (error) {
    closed = true;
    offState();
    offConfig();
    websites.close();
    ips.close();
    backups.close();
    await live.close().catch(() => undefined);
    await detach?.();
    await detachNetwork?.();
    refresh.close();
    updates.close();
    nodes.close();
    service.close();
    throw error;
  }
  const transport = new MobileClientTransport(service);
  const maintenance = new MaintenanceCycle(store, host.now);
  return {
    transport,
    service,
    config,
    capabilities,
    refresh,
    releaseView: (owner: string) => live.releaseOwner(owner),
    /** Called by the native host's wake-up, never by a page read or the version button. */
    async runMaintenance() {
      if (closed) throw new Error('Mobile service is closed');
      return maintenance.runDue(
        async () => {
          // Release checks have no configuration dependency. Refresh must finish replacing
          // group membership before network observations use the new saved configuration.
          const results = await Promise.allSettled([
            updates.check(),
            (async () => {
              refresh.request({ all: true });
              await refresh.idle();
              if (closed) return;
              await Promise.all([ips.refresh(), websites.run()]);
            })(),
          ]);
          for (const result of results) if (result.status === 'rejected') report('后台维护');
        },
        () => !closed
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      refresh.close();
      updates.close();
      nodes.close();
      transport.close();
      service.close();
      await detach?.();
      await detachNetwork?.();
      offState();
      offConfig();
      websites.close();
      ips.close();
      backups.close();
      await live.close();
    },
  };
}
