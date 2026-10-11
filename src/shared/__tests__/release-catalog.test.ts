import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyReleaseCatalog } from '../release-catalog';
import { fetchPublisherReleases } from '../publisher-release-source';
const now = 1800000000000;
const pair = generateKeyPairSync('ed25519');
const trust = { id: 'test-only', publicKey: pair.publicKey.export({ format: 'jwk' }).x! };
const release = {
  tag_name: 'v0.2.0',
  draft: false,
  prerelease: false,
  body: '',
  html_url: 'https://github.com/dsanying/VPN/releases/tag/v0.2.0',
  assets: [
    {
      name: 'client.apk',
      size: 100,
      digest: `sha256:${'a'.repeat(64)}`,
      browser_download_url: 'https://github.com/dsanying/VPN/releases/download/v0.2.0/client.apk',
    },
  ],
};
function envelope(change: Record<string, unknown> = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      issuedAt: now,
      expiresAt: now + 86400000,
      publishers: { 'dsanying/VPN': [release] },
      ...change,
    })
  );
  return JSON.stringify({
    keyId: trust.id,
    payload: payload.toString('base64url'),
    signature: sign(null, payload, pair.privateKey).toString('base64url'),
  });
}
test('authenticates catalog before using the exact publisher asset identity and digest', async () => {
  expect(await verifyReleaseCatalog(envelope(), 'dsanying/VPN', now, trust)).toEqual([release]);
});
test('an authenticated empty software repository is a known pre-release state, while empty engine metadata is rejected', async () => {
  const body = envelope({ publishers: { 'dsanying/VPN': [], 'SagerNet/sing-box': [] } });
  expect(await verifyReleaseCatalog(body, 'dsanying/VPN', now, trust)).toEqual([]);
  await expect(verifyReleaseCatalog(body, 'SagerNet/sing-box', now, trust)).rejects.toThrow(
    'no publisher releases'
  );
});
test('durable acceptance happens only after complete signature and asset validation', async () => {
  const accept = jest.fn(async () => undefined);
  await verifyReleaseCatalog(envelope(), 'dsanying/VPN', now, trust, { accept });
  expect(accept).toHaveBeenCalledWith({
    keyId: trust.id,
    issuedAt: now,
    digest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  accept.mockClear();
  await expect(
    verifyReleaseCatalog(envelope({ schema: 2 }), 'dsanying/VPN', now, trust, { accept })
  ).rejects.toThrow();
  expect(accept).not.toHaveBeenCalled();
});
test('tampered payloads, unknown signers and malformed signature fail authentication', async () => {
  const value = JSON.parse(envelope());
  for (const change of [
    { keyId: 'other' },
    { signature: 'A'.repeat(86) },
    { payload: Buffer.from('{}').toString('base64url') },
  ])
    await expect(
      verifyReleaseCatalog(JSON.stringify({ ...value, ...change }), 'dsanying/VPN', now, trust)
    ).rejects.toThrow();
});
test.each([
  { expiresAt: now },
  { issuedAt: now + 300001 },
  { expiresAt: now + 8 * 86400000 },
  { schema: 2 },
  {
    publishers: {
      'dsanying/VPN': [
        {
          ...release,
          assets: [
            { ...release.assets[0], browser_download_url: 'https://example.com/client.apk' },
          ],
        },
      ],
    },
  },
  {
    publishers: {
      'dsanying/VPN': [{ ...release, assets: [{ ...release.assets[0], digest: undefined }] }],
    },
  },
  {
    publishers: {
      'dsanying/VPN': [{ ...release, assets: [release.assets[0], release.assets[0]] }],
    },
  },
])(
  'even signed stale, malformed or incorrectly scoped catalogs are rejected: %p',
  async (change) => {
    await expect(
      verifyReleaseCatalog(envelope(change), 'dsanying/VPN', now, trust)
    ).rejects.toThrow();
  }
);
test('untrusted catalog failure returns to the official publisher API; mirror text never supplies a digest', async () => {
  const read = jest.fn(async (url: string) =>
    url.includes('github.io')
      ? { status: 200, body: envelope() }
      : { status: 200, body: JSON.stringify([release]) }
  );
  expect(await fetchPublisherReleases('dsanying/VPN', read)).toEqual([release]);
  expect(read.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
    'dsanying.github.io',
    'api.github.com',
  ]);
});
