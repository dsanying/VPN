import type { ConfigRepository } from './config-repository';
import type { PortableCoreController } from './portable-core-controller';
import type { PortableLogRepository } from './portable-log-repository';
import { buildDiagnosticReport, collectNodeIdentifiers } from './diagnostic-redact';
import { redactLogText } from './log-redact';
import { formatDeviceDate } from './device-time';

interface DiagnosticHost {
  clientInfo(): Promise<{
    appVersion: string;
    singBoxVersion: string;
    platform: string;
    arch: string;
    osVersion: string;
  }>;
  exportDocument(options: { name: string; content: string }): Promise<{ canceled: boolean }>;
}

/** Shared report formatting; native facts and the system document picker remain host-owned. */
export class PortableDiagnostics {
  constructor(
    private repository: Pick<ConfigRepository, 'read'>,
    private core: Pick<PortableCoreController, 'snapshot'>,
    private logs: Pick<PortableLogRepository, 'read'>,
    private host: DiagnosticHost
  ) {}

  async export(): Promise<{ success: boolean; error?: string }> {
    const [config, entries, version] = await Promise.all([
      this.repository.read(),
      this.logs.read(),
      this.host.clientInfo(),
    ]);
    const state = this.core.snapshot();
    // Only structural facts enter the report. Raw imported protocol fields may contain unknown secrets.
    const protocols: Record<string, number> = {};
    for (const server of config.servers)
      protocols[server.protocol] = (protocols[server.protocol] ?? 0) + 1;
    const content = buildDiagnosticReport({
      generatedAt: new Date().toISOString(),
      language: config.language,
      app: {
        flowzVersion: version.appVersion,
        coreVersion: version.singBoxVersion,
        os: `${version.platform} ${version.arch} ${version.osVersion}`,
      },
      runtime: {
        proxyMode: config.proxyMode,
        proxyModeType: 'android-vpn-service',
        proxyRunning: state.running,
        logLevel: 'info',
        captureActive: false,
      },
      redactedUserConfig: {
        serverCount: config.servers.length,
        subscriptionCount: config.subscriptions?.length ?? 0,
        ruleCount: config.customRules?.length ?? 0,
        protocols,
      },
      redactedSingboxConfig: {
        available: false,
        reason: 'Native configuration is not exposed to the renderer',
      },
      appLogTail: redactLogText(
        entries
          .map(
            (entry) =>
              `[${entry.level}] ${entry.timestamp} [${entry.source}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`
          )
          .join('\n')
      ),
      singboxLogTail: '',
      nodeIdentifiers: collectNodeIdentifiers(config),
    });
    const result = await this.host.exportDocument({
      name: `shadowvpn-diagnostic-${formatDeviceDate(new Date())}.md`,
      content,
    });
    return result.canceled ? { success: false, error: 'cancelled' } : { success: true };
  }
}
