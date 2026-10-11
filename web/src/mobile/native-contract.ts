import type { PortableAppliedReceipt } from '@shared/portable-core-controller';
import type { PortableNodeObservation } from '@shared/portable-node-measurements';
import type { InstalledApplication } from '@shared/types';
import type { HostTextTransport } from '@shared/host-text-request';
export interface NativeListenerHandle { remove(): Promise<void>; }

export interface NativeVpnStatus {
  running: boolean;
  busy: boolean;
  startTime?: number;
  uptime?: number;
  error?: string;
  appliedReceipt?: PortableAppliedReceipt;
}
export type NativeCoreTopic = 'stats' | 'connections' | 'logs' | 'outbounds';
export interface NativeCoreEvent {
  topic: NativeCoreTopic | 'connected' | 'streamError' | 'logsReset';
  data: unknown;
}

/** Native primitives; business dispatch is a separate required release capability. */
export interface ShadowVpnNative extends HostTextTransport {
  capabilities(): Promise<{
    platform: 'android';
    vpn: boolean;
    connectionOwner: boolean;
    systemProxy: false;
    desktopLoginAutostart: false;
    externalCoreReplacement: false;
  }>;
  exportDocument(options: { name: string; content: string }): Promise<{ canceled: boolean }>;
  importDocument(): Promise<{ canceled: boolean; content?: string }>;
  openVpnSettings(): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
  prepareCountryRuleSet(options: {
    country: string;
    force?: boolean;
  }): Promise<{ tag: string; path: string; format: 'binary' }>;
  networkContext(): Promise<{ identity: string }>;
  status(): Promise<NativeVpnStatus>;
  listApplications(): Promise<{ applications: InstalledApplication[] }>;
  measureNode(options: {
    id: string;
    config: string;
    tag: string;
    target: string;
    address: string;
    port: number;
  }): Promise<PortableNodeObservation & { body?: string; status?: number }>;
  cancelProbe(options: { id: string }): Promise<void>;
  clientInfo(): Promise<{
    appVersion: string;
    appName: string;
    singBoxVersion: string;
    platform: 'android';
    arch: string;
    osVersion: string;
    buildDate: string;
    copyright: string;
    repositoryUrl: string;
  }>;
  closeConnections(options: { id?: string }): Promise<void>;
  prepareSoftwareUpdate(options: {
    url: string;
    version: string;
    digest: string;
    candidates: string[];
  }): Promise<{ version: string; verified: boolean }>;
  installSoftwareUpdate(): Promise<{
    installationRequested?: boolean;
    permissionRequired?: boolean;
  }>;
  preparedSoftwareUpdate(): Promise<{ update: { version: string; verified: boolean } | null }>;
  clearLogs(): Promise<void>;
  coreVersion(): Promise<{ version: string }>;
  coreEnvironment(): Promise<{ stateDirectory: string; version: string }>;
  checkConfig(options: { config: string }): Promise<void>;
  start(options: { config: string; nodes: Record<string, string> }): Promise<NativeVpnStatus>;
  appliedReceipt(): Promise<
    import('@shared/portable-core-controller').PortableAppliedReceipt | null
  >;
  stop(): Promise<NativeVpnStatus>;
  readState(options: {
    name: string;
  }): Promise<{ content: string | null; revision: string | null }>;
  writeState(options: {
    name: string;
    content: string;
    expectedRevision?: string | null;
  }): Promise<{ revision?: string }>;
  deleteState(options: { name: string }): Promise<void>;
  subscribeCoreEvents(options: { topics: NativeCoreTopic[] }): Promise<void>;
  addListener(
    event: 'statusChanged',
    listener: (status: NativeVpnStatus) => void
  ): Promise<NativeListenerHandle>;
  addListener(
    event: 'networkChanged',
    listener: (state: { identity: string }) => void
  ): Promise<NativeListenerHandle>;
  addListener(
    event: 'coreEvent',
    listener: (event: NativeCoreEvent) => void
  ): Promise<NativeListenerHandle>;
}
