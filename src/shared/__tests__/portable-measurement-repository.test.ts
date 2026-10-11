import { PortableMeasurementRepository } from '../portable-measurement-repository';

const first = 'a'.repeat(64),
  second = 'b'.repeat(64);
function fixture() {
  let content: string | null = null;
  const identities = new Map([['node', first]]);
  const store = {
    read: jest.fn(async () => content),
    write: jest.fn(async (_name: string, value: string) => {
      content = value;
    }),
  };
  const open = () =>
    new PortableMeasurementRepository(
      store,
      'measurements',
      async () => new Map(identities),
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
  return { identities, store, open, repository: open() };
}
test('observations survive reopening, while renamed presentation keeps the same identity', async () => {
  const { repository, open } = fixture();
  await expect(
    repository.save('node', { fingerprint: first, observedAt: 10, value: 120 })
  ).resolves.toBe(true);
  expect((await open().read()).node.value).toBe(120);
});
test('deleted and replaced objects cannot be resurrected by late probe completion', async () => {
  const { repository, identities, store } = fixture();
  await repository.save('node', { fingerprint: first, observedAt: 10, value: 120 });
  identities.set('node', second);
  expect(await repository.save('node', { fingerprint: first, observedAt: 20, value: 80 })).toBe(
    false
  );
  expect(await repository.read()).toEqual({});
  expect(store.write).toHaveBeenCalledTimes(2);
  identities.delete('node');
  expect(await repository.save('node', { fingerprint: second, observedAt: 30, value: 90 })).toBe(
    false
  );
});
test('out-of-order observations retain the newest result', async () => {
  const { repository } = fixture();
  await Promise.all([
    repository.save('node', { fingerprint: first, observedAt: 30, value: 90 }),
    repository.save('node', { fingerprint: first, observedAt: 20, value: 80 }),
  ]);
  expect((await repository.read()).node).toMatchObject({ value: 90, observedAt: 30 });
});
test('database failure rejects the operation and a subsequent retry can succeed', async () => {
  const { repository, store } = fixture();
  store.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(
    repository.save('node', { fingerprint: first, observedAt: 10, value: 120 })
  ).rejects.toThrow('disk full');
  expect(await repository.read()).toEqual({});
  await repository.save('node', { fingerprint: first, observedAt: 10, value: 120 });
  expect((await repository.read()).node.value).toBe(120);
});
test('invalid observations cannot pollute persisted state', async () => {
  const { repository, store } = fixture();
  for (const value of [NaN, Infinity])
    await expect(
      repository.save('node', { fingerprint: first, observedAt: 10, value })
    ).rejects.toThrow();
  await expect(
    repository.save('node', { fingerprint: 'credential', observedAt: 10, value: 10 })
  ).rejects.toThrow();
  expect(store.write).not.toHaveBeenCalled();
});
test('invalid stored records are physically removed during a read', async () => {
  const f = fixture();
  f.store.read.mockResolvedValueOnce(
    JSON.stringify({
      schema: 1,
      records: {
        invalid: { fingerprint: 'broken', observedAt: 1, value: 10 },
        node: { fingerprint: first, observedAt: 2, value: 20 },
      },
    })
  );
  expect(await f.repository.read()).toEqual({
    node: { fingerprint: first, observedAt: 2, value: 20 },
  });
  expect(f.store.write).toHaveBeenCalledWith(
    'measurements',
    JSON.stringify({
      schema: 1,
      records: { node: { fingerprint: first, observedAt: 2, value: 20 } },
    })
  );
});
