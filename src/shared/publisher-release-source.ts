import { readReleaseCatalog, CatalogStateError, type CatalogAcceptance } from './release-catalog';
/** Trusted publisher metadata is independent of download mirrors. */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string;
  size?: number;
}
export interface PublisherRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: ReleaseAsset[];
  body: string;
  published_at?: string;
  html_url: string;
}
export interface ReleaseResponse {
  status: number;
  body: string;
}
export type ReleaseRead = (
  url: string,
  accept: string,
  signal?: AbortSignal
) => Promise<ReleaseResponse>;
const REPOSITORIES = new Set(['dsanying/VPN', 'SagerNet/sing-box']);
const MAX_BYTES = 16 * 1024 * 1024;

function repositoryGuard(repository: string): void {
  if (!REPOSITORIES.has(repository)) throw new Error('Unsupported release publisher');
}
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'is').exec(tag);
  return (
    match?.[2]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'") ?? null
  );
}
function bounded(body: string): string {
  if (new TextEncoder().encode(body).byteLength > MAX_BYTES)
    throw new Error('Release response too large');
  return body.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
}
export function validatePublisherAsset(
  repository: string,
  tag: string,
  name: string,
  raw: string
): void {
  repositoryGuard(repository);
  const url = new URL(raw);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag) ||
    !name ||
    /[\\/]/.test(name) ||
    segments.join('/') !== `${repository}/releases/download/${tag}/${name}` ||
    segments.length !== 6
  ) {
    throw new Error('Invalid publisher release asset');
  }
}
export function parsePublisherAssets(
  repository: string,
  tag: string,
  body: string
): ReleaseAsset[] {
  repositoryGuard(repository);
  const assets: ReleaseAsset[] = [];
  const seen = new Set<string>();
  for (const row of bounded(body).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const anchor = [...row[1].matchAll(/<a\b[^>]*>/gi)]
      .map((match) => attribute(match[0], 'href'))
      .find((href) => href?.includes('/releases/download/'));
    const hashes = [...row[1].matchAll(/<clipboard-copy\b[^>]*>/gi)].map((match) =>
      attribute(match[0], 'value')
    );
    if (!anchor) continue; // source archives are not installer assets
    const digest = hashes.find((value) => value && /^sha256:[a-f0-9]{64}$/i.test(value));
    if (!digest || hashes.filter((value) => value && /^sha256:/i.test(value)).length !== 1) {
      throw new Error('Official release asset has no unambiguous SHA-256');
    }
    const url = new URL(anchor, 'https://github.com');
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    validatePublisherAsset(repository, tag, name, url.href);
    if (seen.has(name)) throw new Error('Duplicate release asset');
    seen.add(name);
    assets.push({ name, browser_download_url: url.href, digest: digest.toLowerCase() });
  }
  if (!assets.length) throw new Error('Official release page has no verified assets');
  return assets;
}
export async function fetchPublisherReleases(
  repository: string,
  read: ReleaseRead,
  acceptance?: CatalogAcceptance
): Promise<PublisherRelease[]> {
  repositoryGuard(repository);
  // Apply the same deadline even when a host transport ignores AbortSignal.
  // Each fallback gets a bounded attempt and forwards cancellation to its transport.
  const boundedRead: ReleaseRead = (url, accept, signal) => {
    const deadline = AbortSignal.timeout(15000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new Error('Release metadata request cancelled or timed out'));
      if (combined.aborted) {
        cancel();
        return;
      }
      combined.addEventListener('abort', cancel, { once: true });
      Promise.resolve()
        .then(() => read(url, accept, combined))
        .then(resolve, reject)
        .finally(() => combined.removeEventListener('abort', cancel));
    });
  };
  return fetchBoundedPublisherReleases(repository, boundedRead, acceptance);
}
async function fetchBoundedPublisherReleases(
  repository: string,
  read: ReleaseRead,
  acceptance?: CatalogAcceptance
): Promise<PublisherRelease[]> {
  try {
    return await readReleaseCatalog(repository, read, acceptance);
  } catch (error) {
    if (error instanceof CatalogStateError) throw error;
    /* Official publisher fallback remains available. */
  }
  let apiError: unknown;
  try {
    const response = await read(
      `https://api.github.com/repos/${repository}/releases`,
      'application/vnd.github+json'
    );
    if (response.status !== 200) throw new Error(`GitHub API HTTP ${response.status}`);
    const releases: unknown = JSON.parse(bounded(response.body));
    if (!Array.isArray(releases)) throw new Error('Invalid release response');
    for (const release of releases) {
      if (!release || typeof release.tag_name !== 'string' || !Array.isArray(release.assets))
        throw new Error('Invalid release metadata');
      for (const asset of release.assets) {
        validatePublisherAsset(
          repository,
          release.tag_name,
          asset.name,
          asset.browser_download_url
        );
      }
    }
    // Missing digests on the latest stable release must not silently disable verified updates.
    const stable = releases.find((release) => !release.draft && !release.prerelease);
    if (
      stable &&
      stable.assets.some(
        (asset: ReleaseAsset) => !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '')
      )
    ) {
      throw new Error('Official API asset digest is unavailable');
    }
    return releases;
  } catch (error) {
    apiError = error;
  }
  const page = await read(`https://github.com/${repository}/releases/latest`, 'text/html');
  if (page.status === 404 && repository === 'dsanying/VPN') return []; // first public release
  if (page.status !== 200)
    throw new Error(
      `Official release metadata unavailable: ${String(apiError)}; HTML HTTP ${page.status}`
    );
  const pageBody = bounded(page.body);
  // GitHub redirects /latest to the 200 release index before the first publication.
  if (
    repository === 'dsanying/VPN' &&
    /<h2\b[^>]*>\s*There (?:aren’t|aren't|aren&#39;t) any releases here\s*<\/h2>/i.test(pageBody)
  )
    return [];
  const fragment = [...pageBody.matchAll(/<include-fragment\b[^>]*>/gi)]
    .map((match) => attribute(match[0], 'src'))
    .find((src) => src?.includes('/releases/expanded_assets/'));
  if (!fragment) throw new Error('Official release page format is unsupported');
  const url = new URL(fragment, 'https://github.com');
  const tag = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/${repository}/releases/expanded_assets/${tag}` ||
    !/^v?\d+\.\d+\.\d+$/.test(tag)
  ) {
    throw new Error('Invalid official stable release fragment');
  }
  const result = await read(url.href, 'text/html');
  if (result.status !== 200) throw new Error(`Official release assets HTTP ${result.status}`);
  return [
    {
      tag_name: tag,
      assets: parsePublisherAssets(repository, tag, result.body),
      prerelease: false,
      draft: false,
      body: '',
      html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    },
  ];
}
