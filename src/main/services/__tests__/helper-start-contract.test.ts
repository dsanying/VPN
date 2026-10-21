import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-helper-contract-'));
jest.mock('electron', () => ({
  app: { getPath: () => TMP, getVersion: () => '9.9.9', isPackaged: false, getAppPath: () => TMP },
  BrowserWindow: class {},
  Notification: class {},
  net: {},
  session: {},
}));
import { ProxyManager } from '../ProxyManager';
import { withPlatformAsync } from './platform-test-utils';
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const make = () =>
  Object.assign(Object.create(ProxyManager.prototype), {
    helperManager: { getStatus: jest.fn(), stopCore: jest.fn().mockResolvedValue(undefined) },
    helperGate: jest.fn().mockResolvedValue('proceed'),
    cleanup: jest.fn(),
  });
it.each(['darwin', 'win32', 'linux'] as const)(
  '%s status failures must not silently authorize launch',
  async (platform) => {
    const service = make();
    service.helperManager.getStatus.mockRejectedValue(new Error('helper unavailable'));
    await withPlatformAsync(platform, async () => {
      await expect(service.maybePromptHelperGate({}, true, {})).rejects.toThrow(
        'helper unavailable'
      );
    });
    expect(service.helperGate).not.toHaveBeenCalled();
  }
);
it.each(['darwin', 'win32', 'linux'] as const)(
  '%s unready installed helpers enter the common gate; failed installation aborts',
  async (platform) => {
    const service = make();
    service.helperManager.getStatus.mockResolvedValue({ installed: true, ready: false });
    service.helperGate.mockRejectedValue(new Error('installation cancelled'));
    await withPlatformAsync(platform, async () => {
      await expect(service.maybePromptHelperGate({}, true, {})).rejects.toThrow(
        'installation cancelled'
      );
    });
    expect(service.helperGate).toHaveBeenCalledTimes(1);
  }
);
it.each(['darwin'] as const)(
  '%s ready helpers with stale confdir still enter the gate (start would be denied → per-launch osascript prompt)',
  async (platform) => {
    const service = make();
    service.helperManager.getStatus.mockResolvedValue({
      installed: true,
      ready: true,
      confdirMismatch: true,
    });
    await withPlatformAsync(platform, async () => {
      await service.maybePromptHelperGate({}, true, {});
    });
    expect(service.helperGate).toHaveBeenCalledTimes(1);
  }
);
it('ready helper without any mismatch or background block skips the gate entirely', async () => {
  const service = make();
  service.helperManager.getStatus.mockResolvedValue({
    installed: true,
    ready: true,
    pathMismatch: false,
    confdirMismatch: false,
    backgroundDisabled: false,
  });
  await withPlatformAsync('darwin', async () => {
    await service.maybePromptHelperGate({}, true, {});
  });
  expect(service.helperGate).not.toHaveBeenCalled();
});
it('missing management port stops a spawned core instead of accepting its PID as success', async () => {
  const service = make();
  service.tailscaleApiPort = null;
  await expect(service.waitForCoreReadyOrThrow(12345, 1)).rejects.toThrow('无法确认启动成功');
  expect(service.helperManager.stopCore).toHaveBeenCalledTimes(1);
  expect(service.cleanup).toHaveBeenCalledTimes(1);
});
