import { CHECKERS, classifyWebsite } from '../checkers';
import { SERVICE_IDS } from '../../../../shared/unlock-detection';
import { WEBSITE_CATALOG } from '../../../../shared/website-catalog';
import type { UnlockResponse, UnlockRequest } from '../unlock-http';
const response = (status = 200, body = ''): UnlockResponse => ({
  status,
  body,
  headers: {},
  truncated: false,
  redirectChain: [],
});

describe('official website network connectivity', () => {
  it.each(SERVICE_IDS)('%s uses the official HTTPS page and a HEAD request', async (id) => {
    const fetch = jest.fn(async (_req: UnlockRequest) => response());
    expect(await CHECKERS[id](fetch)).toMatchObject({ status: 'ok', httpStatus: 200 });
    expect(fetch.mock.calls).toEqual([[{ url: WEBSITE_CATALOG[id].url, method: 'HEAD' }]]);
  });
  it.each([200, 204, 301, 401, 403, 404, 429, 500, 503])(
    'HTTP %s proves network reachability, not service availability',
    (code) => {
      expect(classifyWebsite('claude', response(code, 'generic error page'))).toMatchObject({
        status: 'ok',
        httpStatus: code,
      });
    }
  );
  it('does not interpret CAPTCHA, login pages or removed Gemini markers', () => {
    for (const body of [
      'CAPTCHA: verify you are human',
      '<title>Sign in</title>',
      'changed HTML',
      'VPN',
    ]) {
      expect(classifyWebsite('gemini', response(200, body)).status).toBe('ok');
    }
  });
  it('does not infer a block from a Cloudflare challenge response', () => {
    const r = response(403);
    r.headers = { 'cf-mitigated': ['challenge'] };
    expect(classifyWebsite('chatgpt', r)).toMatchObject({ status: 'ok', httpStatus: 403 });
  });
  it.each([403, 451])('explicit country denial in HTTP %s is restricted', (code) => {
    expect(
      classifyWebsite('chatgpt', response(code, '{"error":"unsupported_country"}')).status
    ).toBe('blocked');
    expect(classifyWebsite('netflix', response(code, 'Not available in your country')).status).toBe(
      'blocked'
    );
  });
  it('does not use region text in successful pages/help links as denial', () => {
    expect(
      classifyWebsite('netflix', response(200, 'Help: unavailable in your country')).status
    ).toBe('ok');
  });
  it('recognizes the explicit official Claude regional redirect only', () => {
    const r = response();
    r.redirectChain = [
      { status: 302, location: 'https://www.anthropic.com/app-unavailable-in-region' },
    ];
    expect(classifyWebsite('claude', r).status).toBe('blocked');
    r.redirectChain[0].location = 'https://example.com/app-unavailable-in-region';
    expect(classifyWebsite('claude', r).status).toBe('ok');
  });
  it.each(['timeout', 'CERT_HAS_EXPIRED', 'ECONNRESET', 'insecure-redirect'])(
    'reports %s without claiming a region restriction',
    (error) => {
      expect(classifyWebsite('youtube', { ...response(0), error }).status).toBe(
        error === 'timeout' ? 'timeout' : 'error'
      );
    }
  );
  it('reads at most a short GET denial response after HEAD 403, with no account/token APIs', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(response(403))
      .mockResolvedValueOnce(response(403, 'unsupported_country'));
    expect((await CHECKERS.chatgpt(fetch)).status).toBe('blocked');
    expect(fetch.mock.calls[1]).toEqual([
      { url: WEBSITE_CATALOG.chatgpt.url, method: 'GET', maxBodyBytes: 8192 },
    ]);
  });
  it('a failing region-detail GET cannot erase a successful HEAD connection', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(response(403))
      .mockResolvedValueOnce({ ...response(0), error: 'timeout' });
    expect(await CHECKERS.youtube(fetch)).toMatchObject({ status: 'ok', httpStatus: 403 });
  });
});
