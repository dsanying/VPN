import { PortableWebsiteMeasurements } from '../portable-website-measurements';
import { SERVICE_IDS } from '../unlock-detection';
function setup() {
  const documents = new Map<string, string>();
  let identity = 'first-network';
  const store = {
    read: jest.fn(async (key: string) => documents.get(key) ?? null),
    write: jest.fn(async (key: string, value: string) => {
      documents.set(key, value);
    }),
  };
  const host = {
    requestText: jest.fn(async (_options: unknown) => ({ status: 403, body: '', headers: {} })),
    cancelRequest: jest.fn(async () => {}),
  };
  const publish = jest.fn();
  const service = new PortableWebsiteMeasurements(
    store,
    host,
    async () => ({ identity, route: 'routed' }),
    publish
  );
  return {
    service,
    store,
    host,
    publish,
    documents,
    change: () => {
      identity = 'second-network';
      service.invalidate();
    },
  };
}
it('reads never probe; a completed current-route run persists before publishing and survives reopening', async () => {
  const { service, host, store, publish, documents } = setup();
  expect((await service.read()).checkedAt).toBeNull();
  expect(host.requestText).not.toHaveBeenCalled();
  const first = service.run();
  expect(service.run()).toBe(first);
  const snapshot = await first;
  expect(snapshot.route).toBe('routed');
  expect(Object.keys(snapshot.results)).toHaveLength(SERVICE_IDS.length);
  expect(snapshot.results.netflix).toEqual({
    status: 'ok',
    reason: 'http-response-received',
    httpStatus: 403,
  });
  expect(host.requestText).toHaveBeenCalledTimes(SERVICE_IDS.length);
  expect(
    host.requestText.mock.calls.every(
      ([options]) =>
        (options as { route: string; headersOnly: boolean }).route === 'current' &&
        (options as { headersOnly: boolean }).headersOnly
    )
  ).toBe(true);
  expect(store.write.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
  const reopened = new PortableWebsiteMeasurements(
    store,
    host,
    async () => ({ identity: 'first-network', route: 'routed' }),
    publish
  );
  expect((await reopened.read()).results.netflix).toEqual({ status: 'ok', httpStatus: 403 });
  expect(documents.size).toBe(1);
  expect(host.requestText).toHaveBeenCalledTimes(SERVICE_IDS.length);
});
it('different network identities cannot reuse saved results', async () => {
  const { service, change } = setup();
  await service.run();
  change();
  expect((await service.read()).checkedAt).toBeNull();
});
it('classifies timeout separately and never saves raw host errors or request URLs', async () => {
  const { service, host, documents } = setup();
  host.requestText.mockRejectedValue(
    Object.assign(new Error('private network detail'), { code: 'HTTP_TIMEOUT' })
  );
  const snapshot = await service.run();
  expect(snapshot.results.google.status).toBe('timeout');
  expect(documents.get('website-measurements')).not.toContain('private');
});
it('write failure cannot publish a successful result', async () => {
  const { service, store, publish } = setup();
  store.write.mockRejectedValue(new Error('disk full'));
  await expect(service.run()).rejects.toThrow('disk full');
  expect(publish).not.toHaveBeenCalled();
});
it('cancels in-flight probes on network changes without committing late results', async () => {
  const { service, host, change, store, publish } = setup();
  const pending: Array<() => void> = [];
  host.requestText.mockImplementation(
    () =>
      new Promise((resolve) => pending.push(() => resolve({ status: 200, body: '', headers: {} })))
  );
  const flight = service.run();
  await new Promise((resolve) => setImmediate(resolve));
  expect(pending).toHaveLength(4);
  change();
  pending.forEach((resolve) => resolve());
  await expect(flight).rejects.toThrow('取消');
  expect(host.cancelRequest).toHaveBeenCalledTimes(4);
  expect(store.write).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
it('rejects malformed or incomplete stored snapshots and closed commands', async () => {
  const { service, documents, host } = setup();
  documents.set(
    'website-measurements',
    JSON.stringify({
      schema: 1,
      identity: 'first-network',
      snapshot: { route: 'routed', checkedAt: Date.now(), results: { google: { status: 'ok' } } },
    })
  );
  expect((await service.read()).checkedAt).toBeNull();
  service.close();
  await expect(service.run()).rejects.toThrow('关闭');
  expect(host.requestText).not.toHaveBeenCalled();
});
