import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import {
  refreshAccessToken,
  exchangeAuthorizationCode,
  getValidAccessToken,
  _clearTokenCache,
  type LwaCredentials,
} from '../src/lib/lwa-auth.js';

const CREDS: LwaCredentials = {
  clientId: 'amzn1.application-oa2-client.fake',
  clientSecret: 'amzn1.oa2-cs.v1.fake',
  endpoint: 'https://api.amazon.com/auth/o2/token',
};

describe('lwa-auth', () => {
  // Loosely typed because axios's static `post` overloads don't compose well
  // with vi.spyOn's generic constraint.
  let postSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _clearTokenCache();
    postSpy = vi.spyOn(axios, 'post') as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    postSpy.mockRestore?.();
  });

  it('refreshAccessToken posts grant_type=refresh_token and parses the response', async () => {
    postSpy.mockResolvedValueOnce({
      data: {
        access_token: 'Atza|fresh-access-token',
        refresh_token: 'Atzr|new-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
      },
    });

    const result = await refreshAccessToken('Atzr|original-refresh', CREDS);

    expect(result.access_token).toBe('Atza|fresh-access-token');
    expect(result.expires_in).toBe(3600);
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body, config] = postSpy.mock.calls[0]!;
    expect(url).toBe(CREDS.endpoint);
    expect(String(body)).toContain('grant_type=refresh_token');
    expect(String(body)).toContain('refresh_token=Atzr%7Coriginal-refresh');
    expect(String(body)).toContain('client_id=' + encodeURIComponent(CREDS.clientId));
    const headers = (config as { headers: Record<string, string> }).headers;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('exchangeAuthorizationCode posts grant_type=authorization_code', async () => {
    postSpy.mockResolvedValueOnce({
      data: {
        access_token: 'Atza|x',
        refresh_token: 'Atzr|y',
        token_type: 'bearer',
        expires_in: 3600,
      },
    });

    await exchangeAuthorizationCode('auth-code-123', 'https://example.com/cb', CREDS);

    const body = String(postSpy.mock.calls[0]![1]);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth-code-123');
    expect(body).toContain('redirect_uri=' + encodeURIComponent('https://example.com/cb'));
  });

  it('rejects responses missing access_token via zod validation', async () => {
    postSpy.mockResolvedValueOnce({
      data: { token_type: 'bearer', expires_in: 3600 },
    });
    await expect(refreshAccessToken('Atzr|x', CREDS)).rejects.toThrow();
  });

  it('getValidAccessToken caches per cacheKey until near expiry', async () => {
    postSpy.mockResolvedValue({
      data: {
        access_token: 'Atza|cached',
        token_type: 'bearer',
        expires_in: 3600,
      },
    });

    const t1 = await getValidAccessToken('seller-1', 'rt', CREDS);
    const t2 = await getValidAccessToken('seller-1', 'rt', CREDS);
    expect(t1).toBe('Atza|cached');
    expect(t2).toBe('Atza|cached');
    expect(postSpy).toHaveBeenCalledTimes(1);

    await getValidAccessToken('seller-2', 'rt', CREDS);
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('getValidAccessToken refreshes when the cached token is within the safety window', async () => {
    postSpy
      .mockResolvedValueOnce({
        data: { access_token: 'Atza|first', token_type: 'bearer', expires_in: 30 },
      })
      .mockResolvedValueOnce({
        data: { access_token: 'Atza|second', token_type: 'bearer', expires_in: 3600 },
      });

    const a = await getValidAccessToken('seller-x', 'rt', CREDS);
    const b = await getValidAccessToken('seller-x', 'rt', CREDS);
    expect(a).toBe('Atza|first');
    expect(b).toBe('Atza|second');
    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});
