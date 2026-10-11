#!/usr/bin/env node
// CI key material is temporary, private and never printed or written into the checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const keyPath = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'shadowvpn-release-signing', 'release.jks');
if (process.argv.includes('--cleanup')) {
  fs.rmSync(path.dirname(keyPath), { recursive: true, force: true });
} else {
  const encoded = process.env.SHADOW_ANDROID_KEYSTORE_BASE64;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('Configure the private SHADOW_ANDROID_KEYSTORE_BASE64 release secret');
  }
  if (!process.env.GITHUB_ENV) throw new Error('Signing setup must run in GitHub Actions');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded) throw new Error('Invalid signing secret encoding');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, bytes, { mode: 0o600, flag: 'wx' });
  fs.appendFileSync(process.env.GITHUB_ENV, `SHADOW_ANDROID_KEYSTORE=${keyPath}\n`);
  console.log('Private Android signing key prepared outside checkout');
}
