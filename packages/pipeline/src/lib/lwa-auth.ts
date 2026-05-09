/**
 * Login With Amazon (LWA) OAuth helpers.
 *
 * The Selling Partner API authenticates requests using a short-lived LWA
 * access token (~1 hour) supplied via the `x-amz-access-token` header.
 * Long-lived refresh tokens are issued during the initial seller-authorization
 * flow and exchanged here for fresh access tokens.
 *
 * AWS SigV4 signing is NOT required for SP-API as of the 2023 update — the
 * LWA bearer token is sufficient.
 */

import axios from 'axios';
import { TokenResponseSchema, type TokenResponse } from '../schemas/lwa.js';

const DEFAULT_LWA_ENDPOINT = 'https://api.amazon.com/auth/o2/token';
const REFRESH_SAFETY_WINDOW_MS = 60_000;

export interface LwaCredentials {
  clientId: string;
  clientSecret: string;
  /** Override the LWA token endpoint (e.g. for tests). */
  endpoint?: string;
}

interface CacheEntry {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CacheEntry>();

function endpoint(creds: LwaCredentials): string {
  return creds.endpoint ?? process.env.SP_API_LWA_ENDPOINT ?? DEFAULT_LWA_ENDPOINT;
}

/**
 * Exchange an authorization code (from the seller-authorization redirect)
 * for an initial access + refresh token pair. Used during the one-time
 * onboarding handshake when a seller connects their Amazon account.
 */
export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  creds: LwaCredentials,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const { data } = await axios.post(endpoint(creds), params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  return TokenResponseSchema.parse(data);
}

/**
 * Trade a refresh token for a new access token. The refresh token itself
 * does not expire under normal use; it's only invalidated when the seller
 * revokes the app or rotates credentials.
 */
export async function refreshAccessToken(
  refreshToken: string,
  creds: LwaCredentials,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const { data } = await axios.post(endpoint(creds), params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  return TokenResponseSchema.parse(data);
}

/**
 * Returns a valid access token, using an in-memory cache keyed by
 * `cacheKey` (typically the seller id). Refreshes ~60s before expiry.
 *
 * The cache is process-local. In serverless contexts (Cloudflare Workers)
 * this still helps within a single isolate's lifetime; cross-isolate
 * sharing would require an external KV / cache and is out of scope here.
 */
export async function getValidAccessToken(
  cacheKey: string,
  refreshToken: string,
  creds: LwaCredentials,
): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now + REFRESH_SAFETY_WINDOW_MS) {
    return cached.accessToken;
  }
  const fresh = await refreshAccessToken(refreshToken, creds);
  tokenCache.set(cacheKey, {
    accessToken: fresh.access_token,
    expiresAt: now + fresh.expires_in * 1000,
  });
  return fresh.access_token;
}

/** Test-only: clear the in-memory token cache. */
export function _clearTokenCache(): void {
  tokenCache.clear();
}
