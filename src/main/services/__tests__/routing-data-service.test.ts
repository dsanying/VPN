import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-routing-data-'));
jest.mock('electron', () => ({
  app: { getPath: () => TMP, getAppPath: () => TMP, isPackaged: false },
  net: {},
}));
import { RoutingDataService } from '../RoutingDataService';
import { getRuleSetRuntimeDir } from '../builtin-geo-rulesets';
import type { UserConfig } from '../../../shared/types';

const cfg = () =>
  ({ servers: [], customRules: [], proxyMode: 'smart', bypassLAN: false }) as unknown as UserConfig;
function service(isProxyRunning = () => false) {
  const log = jest.fn();
  const onMissingRestored = jest.fn();
  const loadConfig = jest.fn().mockResolvedValue(cfg());
  const data = new RoutingDataService({
    configManager: { loadConfig } as never,
    isProxyRunning,
    updateNetwork: { resolveSessionForMainUpdate: async () => undefined } as never,
    region: () => ({ automatic: true, enabled: true, region: 'jp', reverse: false }),
    log,
    onMissingRestored,
  });
  const fetch = jest.spyOn(data as any, 'fetchBuffer');
  return { data, fetch, log, onMissingRestored, loadConfig };
}
beforeEach(() => {
  fs.rmSync(path.join(TMP, 'rules'), { recursive: true, force: true });
  fs.mkdirSync(getRuleSetRuntimeDir(), { recursive: true });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

it('deduplicates concurrent country downloads and reuses the fresh cache', async () => {
  const { data, fetch } = service();
  fetch.mockResolvedValue({ ok: true, buf: Buffer.from('SRS-valid') });
  expect(
    await Promise.all([data.ensureCountryRuleSet('JP'), data.ensureCountryRuleSet('jp')])
  ).toEqual([true, true]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await data.ensureCountryRuleSet('jp')).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await data.ensureCountryRuleSet('invalid')).toBe(false);
});
it('failed updates retain the last valid cache and apply retry backoff', async () => {
  const file = path.join(getRuleSetRuntimeDir(), 'geoip-jp.srs');
  fs.writeFileSync(file, 'SRS-old');
  fs.utimesSync(file, 1, 1);
  const { data, fetch } = service();
  fetch.mockResolvedValue({ ok: true, buf: Buffer.from('<html>bad</html>') });
  expect(await data.ensureCountryRuleSet('jp')).toBe(true);
  expect(fs.readFileSync(file, 'utf8')).toBe('SRS-old');
  expect(await data.ensureCountryRuleSet('jp')).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('missing data with invalid content is unavailable, never a false success', async () => {
  const { data, fetch } = service();
  fetch.mockResolvedValue({ ok: true, buf: Buffer.from('bad') });
  expect(await data.ensureCountryRuleSet('jp')).toBe(false);
  expect(fs.existsSync(path.join(getRuleSetRuntimeDir(), 'geoip-jp.srs'))).toBe(false);
});
it('cleans old catalog/service files and downloads only demanded country data', async () => {
  const legacy = path.join(TMP, 'rule-resources');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'catalog.json'), '{}');
  fs.writeFileSync(path.join(getRuleSetRuntimeDir(), 'geosite-youtube.srs'), 'SRS');
  fs.writeFileSync(path.join(getRuleSetRuntimeDir(), 'geoip-netflix.srs'), 'SRS');
  fs.writeFileSync(path.join(getRuleSetRuntimeDir(), 'geoip-us.srs'), 'SRS-country-cache');
  const { data, fetch, onMissingRestored, loadConfig } = service();
  fetch.mockResolvedValue({ ok: true, buf: Buffer.from('SRS-valid') });
  await data.refreshRequired();
  expect(fs.existsSync(legacy)).toBe(false);
  expect(fs.existsSync(path.join(getRuleSetRuntimeDir(), 'geosite-youtube.srs'))).toBe(false);
  expect(fs.existsSync(path.join(getRuleSetRuntimeDir(), 'geoip-netflix.srs'))).toBe(false);
  expect(fs.existsSync(path.join(getRuleSetRuntimeDir(), 'geoip-us.srs'))).toBe(true);
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-jp.srs',
  ]);
  expect(onMissingRestored).toHaveBeenCalledTimes(1);
  expect(loadConfig).toHaveBeenCalledTimes(2);
});
it('does not create an independent maintenance clock', async () => {
  jest.useFakeTimers();
  try {
    const { data, loadConfig } = service();
    expect(data).toBeDefined();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(loadConfig).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('prepares changed data without touching live files, then applies only with the proxy stopped', async () => {
  let running = true;
  const file = path.join(getRuleSetRuntimeDir(), 'geoip-jp.srs');
  fs.writeFileSync(file, 'SRS-old');
  const { data, fetch } = service(() => running);
  fetch.mockResolvedValue({ ok: true, buf: Buffer.from('SRS-new') });
  await data.refreshRequired(true);
  expect(fs.readFileSync(file, 'utf8')).toBe('SRS-old');
  expect(data.hasPreparedUpdates()).toBe(true);
  await expect(data.applyPrepared()).rejects.toThrow('Proxy must be stopped');
  running = false;
  await data.applyPrepared();
  expect(fs.readFileSync(file, 'utf8')).toBe('SRS-new');
  expect(data.hasPreparedUpdates()).toBe(false);
});
it('unified checks report network failures while preserving usable cached routing data', async () => {
  const file = path.join(getRuleSetRuntimeDir(), 'geoip-jp.srs');
  fs.writeFileSync(file, 'SRS-old');
  const { data, fetch } = service();
  fetch.mockResolvedValue({ ok: false, errorCode: 'network' });
  await expect(data.refreshRequired(true)).rejects.toThrow('cached data retained');
  expect(fs.readFileSync(file, 'utf8')).toBe('SRS-old');
});
