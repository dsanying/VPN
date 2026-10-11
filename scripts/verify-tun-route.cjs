#!/usr/bin/env node
'use strict';

// Deliberately uses an ordinary Node socket: checks this process through the OS TUN path.
// Does not emulate Firefox, use a proxy port, modify OS routes, or report API readiness as success.
const fs = require('node:fs');
const path = require('node:path');
const { MihomoApiClient } = require('../dist/main/main/services/MihomoApiClient');
const { verifyTunSystemRoute } = require('../dist/main/main/services/SystemRouteVerifier');

async function main() {
  const [configPath, target, outbound, rule] = process.argv.slice(2);
  if (!configPath || !target || !outbound) {
    throw new Error('Usage: node scripts/verify-tun-route.cjs <active-mihomo.json> <https-url> <leaf-outbound> [rule]');
  }
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  if (config.tun?.enable !== true) throw new Error('Active configuration does not enable TUN');
  const endpoint = /^127\.0\.0\.1:(\d+)$/.exec(config['external-controller'] || '');
  if (!endpoint || !config.secret) throw new Error('Authenticated loopback controller required');
  const client = new MihomoApiClient(Number(endpoint[1]), config.secret);
  try {
    const result = await verifyTunSystemRoute(target, {
      outbound,
      ...(rule ? { rule } : {}),
      processPath: process.execPath,
    }, () => client.readConnections(300));
    // No config, target, credentials, node addresses, or process paths enter test output.
    console.log(JSON.stringify({
      scope: 'actual-os-tun-node-process',
      status: result.status,
      httpStatus: result.httpStatus,
      elapsedMs: result.elapsedMs,
      processMatched: result.observed?.processPath === process.execPath,
      outboundMatched: result.observed?.outbound === outbound,
      ruleMatched: rule === undefined ? undefined : result.observed?.rule === rule,
    }));
    process.exitCode = result.status === 'verified' ? 0 : 1;
  } finally {
    client.stop();
  }
}
main().catch((error) => {
  // External errors may contain private config paths or target hostnames.
  if (error.message.startsWith('Usage:')) console.error(error.message);
  else console.error('System route verification could not complete');
  process.exitCode = 1;
});
