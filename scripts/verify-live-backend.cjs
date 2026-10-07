/** Opt-in verification. Sources and runtime credentials stay outside the checkout. */
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  Module = require('module');
const { execFileSync } = require('child_process');
(async () => {
  if (!process.env.SHADOW_VPN_SOURCE_FILE)
    throw new Error('Set SHADOW_VPN_SOURCE_FILE to a private source file');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-backend-'));
  fs.chmodSync(directory, 0o700);
  const logs = [];
  const log = {
    addLog(level, message) {
      if (level === 'error' || level === 'warn') logs.push({ level, message });
    },
    getLogLevel() {
      return 'warn';
    },
  };
  const load = Module._load;
  Module._load = function (name, ...rest) {
    if (name === 'electron')
      return {
        app: {
          isPackaged: false,
          getPath: () => directory,
          getAppPath: () => process.cwd(),
          getName: () => 'ShadowVPN',
          getVersion: () => '0.1.0',
        },
        net: { fetch: global.fetch },
        session: { fromPartition: () => ({ setProxy: async () => {}, fetch: global.fetch }) },
        BrowserWindow: class {},
        Notification: class {},
      };
    return load.call(this, name, ...rest);
  };
  const { SubscriptionService } = require('../dist/main/main/services/SubscriptionService.js');
  const { ProtocolParser } = require('../dist/main/main/services/ProtocolParser.js');
  const { ProxyManager } = require('../dist/main/main/services/ProxyManager.js');
  const { SpeedTestService } = require('../dist/main/main/services/SpeedTestService.js');
  const { isSpeedTestable } = require('../dist/main/shared/endpoint-routes.js');
  const service = new SubscriptionService(new ProtocolParser(log), log);
  const core = path.resolve('resources/mac-arm64/sing-box');
  const manager = new ProxyManager(log, undefined, path.join(directory, 'connection.json'), core);
  const input = JSON.parse(fs.readFileSync(process.env.SHADOW_VPN_SOURCE_FILE, 'utf8'));
  const sources = Array.isArray(input) ? input : input.subscriptions;
  const report = {
    startedAt: new Date().toISOString(),
    core: execFileSync(core, ['version'], { encoding: 'utf8' }).split('\n')[0],
    sourceResults: [],
    systemProxyChanged: false,
  };
  try {
    for (let i = 0; i < sources.length; i++) {
      const fetched = await service.fetchSubscription(sources[i].url, 'source-' + i, false);
      const nodes = fetched.servers.filter(isSpeedTestable);
      const speed = new SpeedTestService(log, (node, tag) =>
        manager.buildSpeedTestOutbound(node, tag)
      );
      const result = await speed.testAllServers(fetched.servers);
      const values = [...result.results.values()];
      const failures = {};
      for (const failure of speed.getLastSpeedTestDiagnostics()?.failures || [])
        failures[failure.reason] = (failures[failure.reason] || 0) + 1;
      const entry = {
        source: i + 1,
        parsed: fetched.servers.length,
        testable: nodes.length,
        measured: result.results.size,
        reachable: values.filter((v) => v !== null).length,
        unreachable: values.filter((v) => v === null).length,
        outcome: result.outcome,
        protocols: [...new Set(nodes.map((n) => n.protocol))],
        failures,
      };
      report.sourceResults.push(entry);
      console.log(JSON.stringify(entry));
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      process.env.SHADOW_VPN_REPORT || path.join(directory, 'report.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('Backend verification failed:', error.code || error.name);
  process.exitCode = 1;
});
