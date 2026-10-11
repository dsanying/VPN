import { WEBSITE_CATALOG } from '../../../shared/website-catalog';
export const EGRESS_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';
export const REQ_TIMEOUT_MS = 8000;
export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_REDIRECTS = 5;
export const CHECKER_BUDGET_MS = 15_000;
/** Public-page aliases for existing orchestration callers. No private API or baked credentials. */
export const GEMINI = { homeUrl: WEBSITE_CATALOG.gemini.url };
export const NETFLIX = { homeUrl: WEBSITE_CATALOG.netflix.url };
export const SPOTIFY = { homeUrl: WEBSITE_CATALOG.spotify.url };
