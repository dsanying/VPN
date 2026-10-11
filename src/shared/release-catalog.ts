import key from './release-catalog-key.json';
import {
  validatePublisherAsset,
  type PublisherRelease,
  type ReleaseRead,
} from './publisher-release-source';

export const CATALOG_URLS = ['https://dsanying.github.io/VPN/releases.json'];
const MAXIMUM = 1024 * 1024;
const PUBLISHERS = ['dsanying/VPN', 'SagerNet/sing-box'];
export interface CatalogReceipt {
  keyId: string;
  issuedAt: number;
  digest: string;
}
export interface CatalogAcceptance {
  accept(receipt: CatalogReceipt): Promise<void>;
}
/** Storage failure must not silently bypass a client's existing rollback protection. */
export class CatalogStateError extends Error {}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid catalog encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) =>
    character.charCodeAt(0)
  );
}
/** Mirrors transport bytes only; a pinned publisher key authenticates every accepted catalog. */
export async function verifyReleaseCatalog(
  body: string,
  repository: string,
  now = Date.now(),
  trusted = key,
  acceptance?: CatalogAcceptance
): Promise<PublisherRelease[]> {
  if (!PUBLISHERS.includes(repository) || new TextEncoder().encode(body).byteLength > MAXIMUM)
    throw new Error('Invalid release catalog');
  const envelope = JSON.parse(body);
  if (
    envelope.keyId !== trusted.id ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string'
  )
    throw new Error('Unknown catalog signer');
  const payload = decode(envelope.payload),
    signature = decode(envelope.signature);
  const publicKey = await crypto.subtle.importKey(
    'raw',
    decode(trusted.publicKey),
    'Ed25519',
    false,
    ['verify']
  );
  if (
    signature.length !== 64 ||
    !(await crypto.subtle.verify('Ed25519', publicKey, signature, payload))
  )
    throw new Error('Invalid catalog signature');
  const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  if (
    catalog.schema !== 1 ||
    !Number.isSafeInteger(catalog.issuedAt) ||
    !Number.isSafeInteger(catalog.expiresAt) ||
    catalog.issuedAt > now + 300000 ||
    catalog.expiresAt <= now ||
    catalog.expiresAt <= catalog.issuedAt ||
    catalog.expiresAt - catalog.issuedAt > 7 * 86400000
  )
    throw new Error('Expired or invalid catalog');
  const releases = catalog.publishers?.[repository];
  if (
    !Array.isArray(releases) ||
    (repository !== 'dsanying/VPN' && !releases.length) ||
    releases.length > 50
  )
    throw new Error('Catalog has no publisher releases');
  for (const release of releases) {
    if (
      !release ||
      release.draft !== false ||
      release.prerelease !== false ||
      typeof release.tag_name !== 'string' ||
      typeof release.body !== 'string' ||
      !Array.isArray(release.assets) ||
      !release.assets.length ||
      release.assets.length > 200
    )
      throw new Error('Invalid catalog release');
    const names = new Set<string>();
    for (const asset of release.assets) {
      if (
        !asset ||
        typeof asset.name !== 'string' ||
        names.has(asset.name) ||
        !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '') ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0
      )
        throw new Error('Invalid catalog asset');
      validatePublisherAsset(repository, release.tag_name, asset.name, asset.browser_download_url);
      names.add(asset.name);
    }
  }
  if (acceptance) {
    const bytes = await crypto.subtle.digest('SHA-256', payload);
    const digest = Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    await acceptance.accept({ keyId: trusted.id, issuedAt: catalog.issuedAt, digest });
  }
  return releases;
}
export async function readReleaseCatalog(
  repository: string,
  read: ReleaseRead,
  acceptance?: CatalogAcceptance
): Promise<PublisherRelease[]> {
  for (const url of CATALOG_URLS) {
    try {
      const response = await read(url, 'application/json', AbortSignal.timeout(5000));
      if (response.status === 200)
        return await verifyReleaseCatalog(response.body, repository, Date.now(), key, acceptance);
    } catch (error) {
      if (error instanceof CatalogStateError) throw error;
      /* Retry the official publisher API/page after any transport or authentication failure. */
    }
  }
  throw new Error('Verified release catalog unavailable');
}
