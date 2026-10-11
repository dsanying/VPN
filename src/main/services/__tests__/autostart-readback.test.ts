const mockSet = jest.fn();
const mockGet = jest.fn();
jest.mock('electron', () => ({
  app: {
    setLoginItemSettings: (...args: unknown[]) => mockSet(...args),
    getLoginItemSettings: (...args: unknown[]) => mockGet(...args),
    getPath: () => '/Applications/Example Client.app/Contents/MacOS/Example Client',
  },
}));
import { createAutoStartManager } from '../AutoStartManager';
beforeEach(() => {
  mockSet.mockReset();
  mockGet.mockReset();
});
it('registers the current executable and reads back the actual OS state', async () => {
  mockGet
    .mockReturnValueOnce({ openAtLogin: false })
    .mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: true });
  expect(await createAutoStartManager().setAutoStart(true)).toBe(true);
  expect(mockSet).toHaveBeenCalledWith({
    openAtLogin: true,
    path: '/Applications/Example Client.app/Contents/MacOS/Example Client',
    ...(process.platform === 'win32' ? { enabled: true } : {}),
  });
  expect(mockGet).toHaveBeenCalledWith({
    path:
      process.platform === 'win32'
        ? '"/Applications/Example Client.app/Contents/MacOS/Example Client"'
        : '/Applications/Example Client.app/Contents/MacOS/Example Client',
  });
});
it('does not mutate the OS when the desired registration already matches', async () => {
  for (const enabled of [false, true]) {
    mockGet.mockReturnValue({ openAtLogin: enabled, executableWillLaunchAtLogin: enabled });
    expect(await createAutoStartManager().setAutoStart(enabled)).toBe(true);
  }
  expect(mockSet).not.toHaveBeenCalled();
});
it('does not report success when registration is refused or throws', async () => {
  mockGet.mockReturnValue({ openAtLogin: false });
  expect(await createAutoStartManager().setAutoStart(true)).toBe(false);
  mockSet.mockImplementation(() => {
    throw new Error('permission denied');
  });
  expect(await createAutoStartManager().setAutoStart(true)).toBe(false);
});
it('verifies disabling rather than assuming a successful setter', async () => {
  mockGet.mockReturnValue({ openAtLogin: true });
  expect(await createAutoStartManager().setAutoStart(false)).toBe(false);
  mockGet.mockReturnValue({ openAtLogin: false });
  expect(await createAutoStartManager().setAutoStart(false)).toBe(true);
});
it('quotes Windows lookup paths and honors the system startup approval state', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    mockGet.mockReturnValue({ openAtLogin: true, executableWillLaunchAtLogin: false });
    expect(await createAutoStartManager().isAutoStartEnabled()).toBe(false);
    expect(mockGet).toHaveBeenCalledWith({
      path: '"/Applications/Example Client.app/Contents/MacOS/Example Client"',
    });
    mockGet.mockReturnValueOnce({ openAtLogin: false }).mockReturnValue({
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
    });
    expect(await createAutoStartManager().setAutoStart(true)).toBe(true);
    expect(mockSet).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      path: '/Applications/Example Client.app/Contents/MacOS/Example Client',
    });
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});
