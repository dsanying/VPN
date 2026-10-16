import { LocalSecretCodec } from '../LocalSecretCodec';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EnterpriseProfileStore } from '../EnterpriseProfileStore';
import { EnterpriseDiscovery } from '../EnterpriseDiscovery';
import {
  identifyEnterpriseGateway,
  normalizeEnterpriseGateway,
} from '../../../../shared/enterprise-vpn';
import { BACKGROUND_REFRESH_MS } from '../../../../shared/background-refresh';
const gateway = 'https://example.com/';
const detected = { gateway, protocol: 'anyconnect' as const, authentication: 'password' as const };
describe('enterprise identity and credential boundaries', () => {
  test('uses response evidence, not hostname guesses; refuses ambiguous vendor pages', () => {
    expect(identifyEnterpriseGateway(gateway, 'Cisco AnyConnect')).toMatchObject({
      protocol: 'anyconnect',
    });
    expect(identifyEnterpriseGateway(gateway, 'Ivanti Connect Secure DanaInfo')).toMatchObject({
      protocol: 'pulse',
    });
    expect(
      identifyEnterpriseGateway('https://atrust.example.com/', 'nothing').protocol
    ).toBeUndefined();
    expect(identifyEnterpriseGateway(gateway, 'aTrust Cisco AnyConnect').protocol).toBeUndefined();
    for (const unsafe of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/?token=fictional',
      'https://example.com/#secret',
    ])
      expect(() => normalizeEnterpriseGateway(unsafe)).toThrow();
  });
  test('encrypted SQLite never exposes a password to the renderer; identity edits clear it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-test-'));
    const file = join(dir, 'profiles.sqlite');
    const key = randomBytes(32);
    const store = new EnterpriseProfileStore(file, {
      encrypt: (value) => {
        const iv = randomBytes(12);
        const c = createCipheriv('aes-256-gcm', key, iv);
        const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), data]);
      },
      decrypt: (value) => {
        const c = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
        c.setAuthTag(value.subarray(12, 28));
        return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString('utf8');
      },
    });
    try {
      const p = store.save(
        { gateway, username: 'fictional-user', password: 'fictional-secret' },
        detected
      );
      expect(p).not.toHaveProperty('password');
      expect(store.list()[0]).not.toHaveProperty('password');
      expect(store.get(p.id).password).toBe('fictional-secret');
      expect(readFileSync(file).includes(Buffer.from('fictional-secret'))).toBe(false);
      expect(readFileSync(file).includes(Buffer.from('fictional-user'))).toBe(false);
      expect(
        store.save({ id: p.id, gateway, username: 'fictional-user' }, detected).hasPassword
      ).toBe(true);
      expect(
        store.save({ id: p.id, gateway, username: 'different-user' }, detected).hasPassword
      ).toBe(false);
      expect(() =>
        store.save({ gateway, username: 'user', password: 'secret\ncommand' }, detected)
      ).toThrow();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('six-hour evidence cache is single flight and never crosses a redirect origin', async () => {
    let now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const read = jest.fn(async () => ({ body: 'Cisco AnyConnect', headers: {} }));
    const discovery = new EnterpriseDiscovery(read);
    try {
      await Promise.all([discovery.detect(gateway), discovery.detect(gateway)]);
      expect(read).toHaveBeenCalledTimes(1);
      now += BACKGROUND_REFRESH_MS - 1;
      await discovery.detect(gateway);
      expect(read).toHaveBeenCalledTimes(1);
      now++;
      await discovery.detect(gateway);
      expect(read).toHaveBeenCalledTimes(2);
      const redirect = jest.fn(async () => ({
        body: 'SSO',
        headers: { location: 'https://elsewhere.example.com/' },
      }));
      expect((await new EnterpriseDiscovery(redirect).detect(gateway)).protocol).toBeUndefined();
      expect(redirect).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('application-owned local encryption', () => {
  test('survives reopen, rejects tampering and keeps the key out of SQLite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'enterprise-key-test-'));
    try {
      const file = join(directory, 'enterprise.key');
      const codec = new LocalSecretCodec(file);
      const encrypted = codec.encrypt('fictional-password');
      expect(new LocalSecretCodec(file).decrypt(encrypted)).toBe('fictional-password');
      expect(readFileSync(file)).toHaveLength(32);
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
      const altered = Buffer.from(encrypted);
      altered[altered.length - 1] ^= 1;
      expect(() => codec.decrypt(altered)).toThrow();
      expect(() => codec.decrypt(Buffer.from('legacy ciphertext'))).toThrow('旧系统加密配置');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
