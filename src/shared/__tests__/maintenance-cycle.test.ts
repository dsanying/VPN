import { MaintenanceCycle } from '../maintenance-cycle';
import { BACKGROUND_REFRESH_MS as PERIOD } from '../background-refresh';

function fixture(content: string | null = null) {
  let time = 100000;
  const store = {
    read: jest.fn(async () => content),
    write: jest.fn(async (_name: string, value: string) => {
      content = value;
    }),
  };
  return {
    store,
    now: () => time,
    advance: (value: number) => {
      time += value;
    },
  };
}
test('a new host instance retains cadence and executes exactly at the six-hour boundary', async () => {
  const f = fixture(),
    action = jest.fn(async () => {});
  await new MaintenanceCycle(f.store, f.now).runDue(action);
  f.advance(PERIOD - 1);
  await new MaintenanceCycle(f.store, f.now).runDue(action);
  expect(action).toHaveBeenCalledTimes(1);
  f.advance(1);
  await new MaintenanceCycle(f.store, f.now).runDue(action);
  expect(action).toHaveBeenCalledTimes(2);
});
test('concurrent wake-ups share the same durable claim and completion', async () => {
  const f = fixture();
  let finish!: () => void;
  const action = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const cycle = new MaintenanceCycle(f.store, f.now);
  const first = cycle.runDue(action),
    second = cycle.runDue(action);
  expect(second).toBe(first);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.store.write).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
});
test('failed network work is not retriggered by restarting the client', async () => {
  const f = fixture(),
    action = jest.fn(async () => {
      throw new Error('offline');
    });
  await expect(new MaintenanceCycle(f.store, f.now).runDue(action)).rejects.toThrow('offline');
  await new MaintenanceCycle(f.store, f.now).runDue(action);
  expect(action).toHaveBeenCalledTimes(1);
});
test.each([
  '{',
  '{"schema":2,"attemptedAt":999999}',
  '{"schema":1,"attemptedAt":999999}',
  '{"schema":1,"attemptedAt":-1}',
])('malformed or future receipts cannot suppress maintenance: %s', async (content) => {
  const f = fixture(content),
    action = jest.fn(async () => {});
  await new MaintenanceCycle(f.store, f.now).runDue(action);
  expect(action).toHaveBeenCalledTimes(1);
});
test('a failed durable claim performs no network work and can be retried after storage recovers', async () => {
  const f = fixture(),
    action = jest.fn(async () => {});
  f.store.write.mockRejectedValueOnce(new Error('disk full'));
  const cycle = new MaintenanceCycle(f.store, f.now);
  await expect(cycle.runDue(action)).rejects.toThrow('disk full');
  expect(action).not.toHaveBeenCalled();
  await cycle.runDue(action);
  expect(action).toHaveBeenCalledTimes(1);
});
