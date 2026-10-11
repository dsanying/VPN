const mockOn = jest.fn();
const mockExpose = jest.fn();
const mockSend = jest.fn();
jest.mock('electron', () => ({
  ipcRenderer: {
    on: (...args: unknown[]) => mockOn(...args),
    send: (...args: unknown[]) => mockSend(...args),
  },
  contextBridge: { exposeInMainWorld: (...args: unknown[]) => mockExpose(...args) },
}));
beforeAll(() => {
  require('../preload-update-popup');
});
import { IPC_CHANNELS } from '../../shared/ipc-channels';
it('订阅前已到达的更新状态立即回放，退订后不继续通知', () => {
  const receive = mockOn.mock.calls.find((c) => c[0] === IPC_CHANNELS.UPDATE_POPUP_STATE)[1];
  const api = mockExpose.mock.calls[0][1];
  const state = { phase: 'progress', percentage: 25 };
  receive({}, state);
  const callback = jest.fn();
  const off = api.onState(callback);
  expect(callback).toHaveBeenCalledWith(state);
  receive({}, { phase: 'done' });
  expect(callback).toHaveBeenCalledTimes(2);
  off();
  receive({}, { phase: 'remind' });
  expect(callback).toHaveBeenCalledTimes(2);
  api.sendAction('later');
  expect(mockSend).toHaveBeenCalledWith(IPC_CHANNELS.UPDATE_POPUP_ACTION, 'later');
});
