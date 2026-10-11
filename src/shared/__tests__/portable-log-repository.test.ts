import { PortableLogRepository } from '../portable-log-repository';
import type { LogEntry } from '../types';
const entry = (message: string): LogEntry => ({
  timestamp: '2026-10-11T00:00:00Z',
  level: 'info',
  source: 'fixture',
  message,
});
function fixture(maximum = 2) {
  const documents = new Map<string, string>();
  const store = {
    read: async (name: string) => documents.get(name) ?? null,
    write: jest.fn(async (name: string, content: string) => {
      documents.set(name, content);
    }),
  };
  return { documents, store, logs: new PortableLogRepository(store, maximum) };
}
test('persisted bounded history survives a new instance and returned mutation', async () => {
  const { logs, store } = fixture();
  await Promise.all([
    logs.append([entry('first')]),
    logs.append([entry('second')]),
    logs.append([entry('third')]),
  ]);
  const read = await logs.read();
  read[0].message = 'changed';
  expect((await new PortableLogRepository(store, 2).read()).map((item) => item.message)).toEqual([
    'second',
    'third',
  ]);
});
test('credentials are removed before disk, including stack and historical entries', async () => {
  const { logs, documents, store } = fixture();
  await logs.append([
    { ...entry('https://example.com/sub?token=fixture-secret'), stack: 'password=fixture-secret' },
  ]);
  expect(documents.get('logs')).not.toContain('fixture-secret');
  documents.set(
    'logs',
    JSON.stringify({
      schema: 1,
      entries: [{ ...entry('token=historic-secret'), stack: 'password=historic-secret' }],
    })
  );
  expect(JSON.stringify(await new PortableLogRepository(store).read())).not.toContain(
    'historic-secret'
  );
});
test('failed append or clear preserves committed history and serial queue recovers', async () => {
  const { logs, store } = fixture();
  await logs.append([entry('saved')]);
  store.write.mockRejectedValueOnce(new Error('disk'));
  await expect(logs.append([entry('lost')])).rejects.toThrow('disk');
  store.write.mockRejectedValueOnce(new Error('disk'));
  await expect(logs.clear()).rejects.toThrow('disk');
  expect((await logs.read()).map((item) => item.message)).toEqual(['saved']);
  await logs.append([entry('next')]);
  expect((await logs.read()).map((item) => item.message)).toEqual(['saved', 'next']);
});
test('large Unicode logs obey a byte budget', async () => {
  const { logs, documents } = fixture(10000);
  await logs.append(
    Array.from({ length: 400 }, () => ({ ...entry('中'.repeat(8192)), stack: '中'.repeat(8192) }))
  );
  expect(new TextEncoder().encode(documents.get('logs')).byteLength).toBeLessThan(
    8 * 1024 * 1024 + 100
  );
  expect((await logs.read()).length).toBeLessThan(400);
});
