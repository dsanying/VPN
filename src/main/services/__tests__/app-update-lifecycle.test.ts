import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-app-update-'));
jest.mock('electron', () => ({
  app: { getPath: () => TMP, getVersion: () => '0.1.0', isPackaged: true, getAppPath: () => TMP },
  shell: {},
  BrowserWindow: class {},
  dialog: {},
  net: {},
}));
import { app } from 'electron';
import { UpdateService } from '../UpdateService';
const info = {
  version: 'v0.2.0',
  fileName: 'example.dmg',
  downloadUrl: 'https://github.com/dsanying/VPN/releases/download/v0.2.0/example.dmg',
  fileSize: 7,
  title: 'Example',
  releaseNotes: '',
  publishedAt: '',
  isPrerelease: false,
};
const bytes = Buffer.from('example');
const digest = createHash('sha256').update(bytes).digest('hex');
function service(): any {
  return new UpdateService({ addLog: jest.fn() } as never);
}
beforeEach(() => {
  fs.rmSync(path.join(TMP, 'updates'), { recursive: true, force: true });
});
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
it('joins simultaneous checks and silently downloads once, without installing', async () => {
  const s = service();
  s.checkForUpdate = jest.fn(async () => ({ hasUpdate: true, updateInfo: info }));
  s.downloadFile = jest.fn(async (_url: string, dest: string) => {
    fs.writeFileSync(dest, bytes);
    s.verifiedDownloads.set(dest, digest);
  });
  s.installUpdate = jest.fn();
  const [a, b] = await Promise.all([s.prepareUpdate(), s.prepareUpdate()]);
  expect(a.hasUpdate).toBe(true);
  expect(b).toEqual(a);
  expect(s.downloadFile).toHaveBeenCalledTimes(1);
  expect(s.installUpdate).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(TMP, 'updates', 'pending.json'))).toBe(true);
});
it('restores a downloaded update after process restart and verifies the official hash', async () => {
  const s = service();
  s.downloadFile = jest.fn(async (_url: string, dest: string) => {
    fs.writeFileSync(dest, bytes);
    s.verifiedDownloads.set(dest, digest);
  });
  await s.downloadUpdate(info);
  const next = service();
  next.officialAssetDigest = jest.fn(async () => digest);
  next.checkForUpdate = jest.fn();
  expect((await next.prepareUpdate()).hasUpdate).toBe(true);
  expect(next.readyUpdate.info.version).toBe(info.version);
  expect(next.verifiedDownloads.get(next.readyUpdate.filePath)).toBe(digest);
  expect(next.checkForUpdate).not.toHaveBeenCalled();
});
it('rejects a tampered cached installer and checks for a fresh update instead', async () => {
  const s = service();
  s.downloadFile = jest.fn(async (_url: string, dest: string) => {
    fs.writeFileSync(dest, bytes);
    s.verifiedDownloads.set(dest, digest);
  });
  const dest = await s.downloadUpdate(info);
  fs.writeFileSync(dest, 'changed');
  const next = service();
  next.officialAssetDigest = jest.fn(async () => digest);
  next.checkForUpdate = jest.fn(async () => ({ hasUpdate: false }));
  expect((await next.prepareUpdate()).hasUpdate).toBe(false);
  expect(fs.existsSync(dest)).toBe(false);
});
it('retains pending state on an offline restore; never installs unverified bytes', async () => {
  const s = service();
  s.readyUpdate = { info, filePath: s.installerPath(info), attempted: false };
  s.savePending();
  const next = service();
  next.officialAssetDigest = jest.fn(async () => {
    throw new Error('offline');
  });
  expect((await next.prepareUpdate()).error).toContain('offline');
  expect(fs.existsSync(path.join(TMP, 'updates', 'pending.json'))).toBe(true);
  expect(next.readyUpdate).toBeNull();
});
it('guards development builds, including recovered installers', async () => {
  (app as any).isPackaged = false;
  try {
    const s = service();
    s.checkForUpdate = jest.fn();
    expect((await s.prepareUpdate()).hasUpdate).toBe(false);
    expect(s.checkForUpdate).not.toHaveBeenCalled();
    s.startAutomaticUpdates();
    expect(s.checkForUpdate).not.toHaveBeenCalled();
  } finally {
    (app as any).isPackaged = true;
  }
});
it('legacy software startup creates no separate clock and never installs a recovered package', async () => {
  jest.useFakeTimers();
  try {
    const s = service();
    s.readyUpdate = { info, filePath: 'example', attempted: false };
    s.prepareUpdate = jest.fn();
    s.installUpdate = jest.fn();
    s.promptReadyUpdate = jest.fn();
    s.startAutomaticUpdates();
    s.startAutomaticUpdates();
    await jest.advanceTimersByTimeAsync(2 * 86400000);
    expect(s.prepareUpdate).not.toHaveBeenCalled();
    expect(s.installUpdate).not.toHaveBeenCalled();
    expect(s.promptReadyUpdate).not.toHaveBeenCalled();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('keeps the verified installer when proxy cleanup fails; no quit or replacement', async () => {
  const s = service();
  const dest = s.installerPath(info);
  fs.writeFileSync(dest, bytes);
  s.verifiedDownloads.set(dest, digest);
  s.readyUpdate = { info, filePath: dest, attempted: false };
  s.savePending();
  s.setCleanupCallback(async () => {
    throw new Error('core still running');
  });
  expect(await s.installUpdate(dest)).toBe(false);
  expect(fs.existsSync(dest)).toBe(true);
  expect(s.readyUpdate.attempted).toBe(true);
});
it('shares installation work so double-clicking cannot launch two installers', async () => {
  const s = service();
  let release!: (v: boolean) => void;
  s.installVerifiedUpdate = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      })
  );
  const a = s.installUpdate('example'),
    b = s.installUpdate('example');
  expect(a).toBe(b);
  expect(s.installVerifiedUpdate).toHaveBeenCalledTimes(1);
  release(true);
  expect(await a).toBe(true);
});
it('writes startup confirmation only for a validated update token', () => {
  const token = '00000000-0000-0000-0000-000000000001';
  const old = process.argv;
  try {
    process.argv = [...old, '--shadow-vpn-update-token=../invalid'];
    service().confirmUpdateStartup();
    expect(fs.existsSync(path.join(TMP, 'updates'))).toBe(false);
    process.argv = [...old, `--shadow-vpn-update-token=${token}`];
    service().confirmUpdateStartup();
    expect(fs.readFileSync(path.join(TMP, 'updates', `confirm-${token}`), 'utf8')).toBe('0.1.0');
  } finally {
    process.argv = old;
  }
});

it('discards corrupt state and still checks for new updates', async () => {
  fs.mkdirSync(path.join(TMP, 'updates'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'updates', 'pending.json'), '{broken');
  const s = service();
  s.checkForUpdate = jest.fn(async () => ({ hasUpdate: false }));
  expect((await s.prepareUpdate()).hasUpdate).toBe(false);
  expect(s.checkForUpdate).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(path.join(TMP, 'updates', 'pending.json'))).toBe(false);
});
