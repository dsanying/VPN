import { createPrivateKey, sign, createPublicKey } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const trust = JSON.parse(
  await readFile(new URL('../src/shared/release-catalog-key.json', import.meta.url), 'utf8')
);
const privateKey = createPrivateKey(process.env.SHADOW_RELEASE_CATALOG_KEY ?? '');
if (createPublicKey(privateKey).export({ format: 'jwk' }).x !== trust.publicKey)
  throw new Error('Signing key does not match the pinned catalog key');
const publishers = {};
for (const repository of ['dsanying/VPN', 'SagerNet/sing-box']) {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=30`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Publisher metadata failed: ${response.status}`);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error('Invalid publisher metadata');
  publishers[repository] = releases
    .filter(
      (release) =>
        !release.draft && !release.prerelease && /^v?\d+\.\d+\.\d+$/.test(release.tag_name)
    )
    .map((release) => ({
      tag_name: release.tag_name,
      draft: false,
      prerelease: false,
      body: release.body ?? '',
      published_at: release.published_at,
      html_url: release.html_url,
      assets: release.assets.map((asset) => {
        const expected = `https://github.com/${repository}/releases/download/${release.tag_name}/${encodeURIComponent(asset.name)}`;
        if (
          asset.browser_download_url !== expected ||
          !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '') ||
          !Number.isSafeInteger(asset.size) ||
          asset.size <= 0
        )
          throw new Error('Publisher asset has no verified digest or identity');
        return {
          name: asset.name,
          browser_download_url: asset.browser_download_url,
          digest: asset.digest,
          size: asset.size,
        };
      }),
    }));
}
const now = Date.now();
const payload = Buffer.from(
  JSON.stringify({ schema: 1, issuedAt: now, expiresAt: now + 2 * 86400000, publishers })
);
const envelope = JSON.stringify({
  keyId: trust.id,
  payload: payload.toString('base64url'),
  signature: sign(null, payload, privateKey).toString('base64url'),
});
if (Buffer.byteLength(envelope) > 1024 * 1024) throw new Error('Catalog exceeds the client bound');
const output = resolve(process.env.CATALOG_OUTPUT ?? 'dist-catalog');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'releases.json'), envelope + '\n');
console.log('Signed catalog prepared from official publisher metadata.');
