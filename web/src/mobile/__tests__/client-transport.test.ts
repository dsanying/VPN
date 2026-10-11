import { MobileClientTransport } from '../client-transport';
import { PortableClientService } from '@shared/portable-client-service';
function fixture() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const on = jest
    .spyOn(PortableClientService.prototype, 'on')
    .mockImplementation((channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener);
      };
    });
  const invoke = jest
    .spyOn(PortableClientService.prototype, 'invoke')
    .mockResolvedValue({
      success: false,
      code: 'HOST_CAPABILITY_UNAVAILABLE',
      error: 'Unavailable',
    });
  const service = Object.create(PortableClientService.prototype) as PortableClientService;
  const transport = new MobileClientTransport(service);
  const emit = (channel: string, data: unknown) =>
    [...(listeners.get(channel) ?? [])].forEach((listener) => listener(data));
  return { transport, on, invoke, emit };
}
afterEach(() => jest.restoreAllMocks());
test('single-use events detach before a recursive notification', () => {
  const f = fixture();
  const listener = jest.fn(() => f.emit('event', 2));
  f.transport.once('event', listener);
  f.emit('event', 1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(undefined, 1);
});
test('removing one callback preserves unrelated subscribers and repeat registrations', () => {
  const f = fixture(),
    one = jest.fn(),
    two = jest.fn();
  const detach = f.transport.on('event', one);
  f.transport.on('event', one);
  f.transport.on('event', two);
  detach();
  f.emit('event', 1);
  expect(one).toHaveBeenCalledTimes(1);
  expect(two).toHaveBeenCalledTimes(1);
  f.transport.off('event', one);
  f.emit('event', 2);
  expect(one).toHaveBeenCalledTimes(1);
  expect(two).toHaveBeenCalledTimes(2);
  f.transport.close();
  f.emit('event', 3);
  expect(two).toHaveBeenCalledTimes(2);
});
test('native failures pass through unchanged and closed transports reject new commands', async () => {
  const f = fixture();
  expect(await f.transport.invoke('not-supported')).toEqual({
    success: false,
    code: 'HOST_CAPABILITY_UNAVAILABLE',
    error: 'Unavailable',
  });
  f.transport.close();
  await expect(f.transport.invoke('anything')).rejects.toThrow('closed');
  expect(() => f.transport.on('anything', () => undefined)).toThrow('closed');
});
