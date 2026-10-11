import { ReleaseCatalogState } from '../release-catalog-state';
import * as catalog from '../release-catalog';
import { fetchPublisherReleases } from '../publisher-release-source';

const first = { keyId: 'test-only', issuedAt: 100, digest: 'a'.repeat(64) };
function database() {
  let data: string | null = null;
  const store = {
    read: jest.fn(async () => data),
    write: jest.fn(async (_name: string, content: string) => {
      data = content;
    }),
  };
  return { store, state: new ReleaseCatalogState(store) };
}
test('accepted high-water mark survives a new service and rejects rollback and conflicting same-time bytes', async () => {
  const { store, state } = database();
  await state.accept(first);
  const restarted = new ReleaseCatalogState(store);
  await restarted.accept(first);
  expect(store.write).toHaveBeenCalledTimes(1);
  await expect(restarted.accept({ ...first, issuedAt: 99 })).rejects.toThrow('rollback');
  await expect(restarted.accept({ ...first, digest: 'b'.repeat(64) })).rejects.toThrow(
    'conflicting'
  );
  await restarted.accept({ ...first, issuedAt: 101, digest: 'c'.repeat(64) });
  expect(store.write).toHaveBeenCalledTimes(2);
});
test('parallel software/core acceptances serialize, including after a failed write', async () => {
  const { store, state } = database();
  store.write.mockRejectedValueOnce(new Error('disk failure'));
  const results = await Promise.allSettled([
    state.accept(first),
    state.accept({ ...first, issuedAt: 102 }),
    state.accept({ ...first, issuedAt: 101 }),
  ]);
  expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'rejected']);
  expect(store.write).toHaveBeenCalledTimes(2);
});
test('malformed existing trust state is never erased to authorize new downloads', async () => {
  const { store, state } = database();
  store.read.mockResolvedValue('{"schema":1,"records":[{"keyId":"test-only"}]}');
  await expect(state.accept(first)).rejects.toThrow('Invalid catalog receipt');
  expect(store.write).not.toHaveBeenCalled();
});
test('trust-state failure cannot be bypassed through a metadata fallback', async () => {
  const mock = jest
    .spyOn(catalog, 'readReleaseCatalog')
    .mockRejectedValueOnce(new catalog.CatalogStateError('persist failure'));
  const read = jest.fn(async () => ({ status: 200, body: '[]' }));
  try {
    await expect(fetchPublisherReleases('dsanying/VPN', read)).rejects.toThrow('persist failure');
    expect(read).not.toHaveBeenCalled();
  } finally {
    mock.mockRestore();
  }
});
