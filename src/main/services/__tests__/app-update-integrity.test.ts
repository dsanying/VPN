import { GH_PROXY_PRESETS } from '../../../shared/gh-proxy';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-app-integrity-'));
const mockRequest = jest.fn();
jest.mock('electron', () => ({
  app: { getPath: () => TMP, getVersion: () => '0.1.0', isPackaged: false, getAppPath: () => TMP },
  shell: {},
  BrowserWindow: class {},
  dialog: {},
  net: { request: (...args: unknown[]) => mockRequest(...args) },
}));
import { UpdateService } from '../UpdateService';
const body = Buffer.from('official example package');
const sha = createHash('sha256').update(body).digest('hex');
const url = 'https://github.com/dsanying/VPN/releases/download/v0.2.0/example.dmg';
const requests: string[] = [];
function service(digest = sha) {
  const svc = new UpdateService({ addLog: jest.fn() } as never) as unknown as {
    assetDigests: Map<string, string>;
    verifiedDownloads: Map<string, string>;
    fetchReleases: () => Promise<unknown[]>;
    updateSession: () => Promise<null>;
    downloadWithHardening: (
      url: string,
      dest: string,
      size: number,
      retry: boolean,
      cb: { onMirror: () => void; onProgress: () => void }
    ) => Promise<void>;
    installUpdate: (path: string) => Promise<boolean>;
  };
  svc.assetDigests.set(url, digest);
  svc.updateSession = async () => null;
  svc.fetchReleases = async () => [];
  return svc;
}
beforeEach(() => {
  requests.length = 0;
  mockRequest.mockReset();
  mockRequest.mockImplementation(({ url }: { url: string }) => {
    requests.push(url);
    const req = Object.assign(new EventEmitter(), {
      setHeader: () => {},
      end: () => {},
      abort: () => {},
    });
    setImmediate(() => {
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { 'content-length': String(body.length) },
      });
      req.emit('response', res);
      setImmediate(() => {
        res.emit('data', body);
        res.emit('end');
      });
    });
    return req;
  });
});
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
it('accepts only the expected official bytes', async () => {
  const svc = service(),
    dest = path.join(TMP, 'valid.dmg');
  await svc.downloadWithHardening(url, dest, body.length, false, {
    onMirror: () => {},
    onProgress: () => {},
  });
  expect(fs.readFileSync(dest)).toEqual(body);
  expect(svc.verifiedDownloads.get(dest)).toBe(sha);
});
it('rejects same-size substituted bytes, including mirror fallback, without leaving an installer', async () => {
  const svc = service('b'.repeat(64)),
    dest = path.join(TMP, 'bad.dmg');
  await expect(
    svc.downloadWithHardening(url, dest, body.length, false, {
      onMirror: () => {},
      onProgress: () => {},
    })
  ).rejects.toThrow('SHA-256');
  expect(requests).toEqual([url, ...GH_PROXY_PRESETS.map((prefix) => prefix + url)]);
  expect(fs.existsSync(dest)).toBe(false);
  expect(svc.verifiedDownloads.has(dest)).toBe(false);
});
it('refuses a download when the official API has no digest', async () => {
  const svc = service();
  svc.assetDigests.clear();
  await expect(
    svc.downloadWithHardening(url, path.join(TMP, 'missing.dmg'), body.length, false, {
      onMirror: () => {},
      onProgress: () => {},
    })
  ).rejects.toThrow('官方 SHA-256');
  expect(mockRequest).not.toHaveBeenCalled();
});
it('rechecks installer bytes before any installation/privilege operation', async () => {
  const svc = service(),
    dest = path.join(TMP, 'changed.dmg');
  await svc.downloadWithHardening(url, dest, body.length, false, {
    onMirror: () => {},
    onProgress: () => {},
  });
  fs.writeFileSync(dest, Buffer.alloc(body.length, 1));
  expect(await svc.installUpdate(dest)).toBe(false);
});
