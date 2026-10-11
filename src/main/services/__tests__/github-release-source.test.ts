import { fetchPublisherReleases, parsePublisherAssets } from '../github-release-source';
const repo = 'SagerNet/sing-box';
const digest = 'a'.repeat(64);
const url = `https://github.com/${repo}/releases/download/v1.14.3/sing-box-1.14.3-darwin-arm64.tar.gz`;
const html = (href = url, hash = digest) =>
  `<li><a href="${href}">archive</a><clipboard-copy value="sha256:${hash}"></clipboard-copy></li>`;
it('recognizes the real 200 empty release index when API is limited before first publication', async () => {
  const releases = await fetchPublisherReleases('dsanying/VPN', async (url) => ({
    status: url.includes('api.github.com') ? 403 : 200,
    body: url.includes('api.github.com')
      ? 'limited'
      : '<h2 data-view-component="true">There aren’t any releases here</h2>',
  }));
  expect(releases).toEqual([]);
});
it('API 403 uses the official stable page and publisher digest', async () => {
  const read = jest.fn(async (u: string) =>
    u.includes('api.github.com')
      ? { status: 403, body: 'limited' }
      : u.endsWith('/latest')
        ? {
            status: 200,
            body: `<include-fragment src="/${repo}/releases/expanded_assets/v1.14.3"></include-fragment>`,
          }
        : { status: 200, body: html() }
  );
  const releases = await fetchPublisherReleases(repo, read);
  expect(releases[0].assets[0].digest).toBe(`sha256:${digest}`);
  expect(read).toHaveBeenCalledTimes(4);
});
it('rejects another publisher, host, malformed digest and duplicate names', () => {
  for (const source of [
    html(url.replace(repo, 'attacker/repo')),
    html(url.replace('github.com', 'example.com')),
    html(url, 'bad'),
    html() + html(),
  ]) {
    expect(() => parsePublisherAssets(repo, 'v1.14.3', source)).toThrow();
  }
});
it('empty public software repository is not a fabricated update', async () => {
  expect(
    await fetchPublisherReleases('dsanying/VPN', async () => ({ status: 404, body: '' }))
  ).toEqual([]);
});
it('valid API release avoids HTML requests', async () => {
  const read = jest.fn(async () => ({
    status: 200,
    body: JSON.stringify([
      {
        tag_name: 'v1.14.3',
        prerelease: false,
        draft: false,
        assets: [
          {
            name: 'sing-box-1.14.3-darwin-arm64.tar.gz',
            browser_download_url: url,
            digest: `sha256:${digest}`,
          },
        ],
      },
    ]),
  }));
  expect((await fetchPublisherReleases(repo, read)).length).toBe(1);
  expect(read).toHaveBeenCalledTimes(2);
});
it('fallback rejects external and prerelease fragments', async () => {
  for (const fragment of [
    'https://example.com/assets',
    `/${repo}/releases/expanded_assets/v1.15.0-beta.1`,
  ]) {
    await expect(
      fetchPublisherReleases(repo, async (u) =>
        u.includes('api.github.com')
          ? { status: 403, body: '' }
          : { status: 200, body: `<include-fragment src="${fragment}"></include-fragment>` }
      )
    ).rejects.toThrow();
  }
});
it('unsupported HTML fails closed', async () => {
  await expect(
    fetchPublisherReleases(repo, async () => ({ status: 200, body: 'changed markup' }))
  ).rejects.toThrow();
});
