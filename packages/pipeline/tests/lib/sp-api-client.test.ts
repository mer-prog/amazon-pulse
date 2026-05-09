import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { SpApiClient } from '../../src/lib/sp-api-client.js';
import { _clearTokenCache } from '../../src/lib/lwa-auth.js';

const CREDENTIALS = {
  clientId: 'amzn1.application-oa2-client.fake',
  clientSecret: 'amzn1.oa2-cs.v1.fake',
  endpoint: 'https://api.amazon.com/auth/o2/token',
};

function ok<T>(config: InternalAxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
  };
}

/**
 * Build an axios-shaped error so axios-retry's `error.response?.status` checks
 * see what they expect. Using `AxiosError.from` keeps the prototype chain
 * correct (axios-retry calls `isAxiosError`).
 */
function axiosErr(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown = { errors: [{ code: 'QuotaExceeded' }] },
): AxiosError {
  const response: AxiosResponse = {
    data,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Server Error',
    headers: {},
    config,
  };
  const err = new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    config,
    null,
    response,
  );
  return err;
}

const ORDERS_PAYLOAD = {
  payload: {
    Orders: [
      {
        AmazonOrderId: '123-4567890-1234567',
        PurchaseDate: '2026-01-01T00:00:00Z',
        OrderStatus: 'Shipped',
      },
    ],
  },
};

beforeEach(() => {
  _clearTokenCache();
  // The LWA token call goes through axios.post directly — short-circuit it
  // so the SP-API operations under test don't make real network calls.
  vi.spyOn(axios, 'post').mockResolvedValue({
    data: {
      access_token: 'Atza|test-access-token',
      token_type: 'bearer',
      expires_in: 3600,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpApiClient — executeWithRateLimit', () => {
  it('routes requests through the per-operation token bucket', async () => {
    const calls: Array<{ url: string | undefined; method: string | undefined }> = [];
    const adapter: AxiosAdapter = async (config) => {
      calls.push({ url: config.url, method: config.method });
      return ok(config, ORDERS_PAYLOAD);
    };

    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
      // Tight bucket: burst 1 means the second call must wait for refill.
      rateLimits: { getOrders: { rate: 1000, burst: 1 } },
    });

    const r1 = await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });
    const r2 = await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });

    expect(r1.payload.Orders).toHaveLength(1);
    expect(r2.payload.Orders).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('/orders/v0/orders');
  });

  it('blocks when the bucket is exhausted and resumes after refill', async () => {
    const adapter: AxiosAdapter = async (config) => ok(config, ORDERS_PAYLOAD);

    // Virtual scheduler shared with the bucket.
    let now = 0;
    const timers: Array<{ id: number; at: number; fn: () => void }> = [];
    let nextId = 1;
    const setTimer = (fn: () => void, ms: number): number => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      timers.sort((a, b) => a.at - b.at);
      return id;
    };
    const clearTimer = (h: unknown): void => {
      const idx = timers.findIndex((t) => t.id === h);
      if (idx >= 0) timers.splice(idx, 1);
    };
    const advance = async (ms: number): Promise<void> => {
      const target = now + ms;
      while (timers.length > 0 && timers[0]!.at <= target) {
        const t = timers.shift()!;
        now = t.at;
        t.fn();
        for (let i = 0; i < 4; i++) await Promise.resolve();
      }
      now = target;
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
      rateLimits: { getOrders: { rate: 1, burst: 1 } }, // 1 token / sec
      tokenBucketOptions: { now: () => now, setTimer, clearTimer },
    });

    // First call admitted immediately.
    await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });

    // Second call should not resolve until ~1s of virtual time has passed.
    let secondResolved = false;
    const second = client
      .getOrders({ marketplaceIds: ['ATVPDKIKX0DER'], createdAfter: '2026-01-01' })
      .then(() => {
        secondResolved = true;
      });

    await advance(500);
    expect(secondResolved).toBe(false);

    await advance(500);
    await second;
    expect(secondResolved).toBe(true);
  });

  it('drains the bucket when axios-retry handles a 429 so concurrent calls back off', async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
      calls++;
      if (calls === 1) throw axiosErr(config as InternalAxiosRequestConfig, 429);
      return ok(config as InternalAxiosRequestConfig, ORDERS_PAYLOAD);
    };

    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
      rateLimits: { getOrders: { rate: 1000, burst: 5 } },
      retries: 2,
    });

    const result = await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });

    expect(result.payload.Orders).toHaveLength(1);
    expect(calls).toBe(2); // 1 throttled + 1 retry that succeeds
  });

  it('still retries on 5xx without draining the bucket', async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
      calls++;
      if (calls === 1) throw axiosErr(config as InternalAxiosRequestConfig, 503);
      return ok(config as InternalAxiosRequestConfig, ORDERS_PAYLOAD);
    };

    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
      retries: 2,
    });

    const result = await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });
    expect(result.payload.Orders).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('attaches the x-amz-access-token header on every operation', async () => {
    const sentHeaders: Array<unknown> = [];
    const adapter: AxiosAdapter = async (config) => {
      sentHeaders.push(config.headers);
      return ok(config, ORDERS_PAYLOAD);
    };

    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
    });

    await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });

    const h = sentHeaders[0] as AxiosHeaders | Record<string, string> | undefined;
    expect(h).toBeDefined();
    const headerValue =
      h instanceof AxiosHeaders
        ? h.get('x-amz-access-token')
        : (h as Record<string, string>)['x-amz-access-token'];
    expect(headerValue).toBe('Atza|test-access-token');
  });

  it('applies independent buckets per operation', async () => {
    const calls: string[] = [];
    const adapter: AxiosAdapter = async (config) => {
      calls.push(config.url ?? '');
      if (config.url?.startsWith('/orders/v0/orders/')) {
        // getOrderItems response
        return ok(config, { payload: { OrderItems: [], AmazonOrderId: 'X' } });
      }
      return ok(config, ORDERS_PAYLOAD);
    };

    // burst=1 for both, but they should not block each other.
    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
      rateLimits: {
        getOrders: { rate: 1000, burst: 1 },
        getOrderItems: { rate: 1000, burst: 1 },
      },
    });

    const [orders, items] = await Promise.all([
      client.getOrders({
        marketplaceIds: ['ATVPDKIKX0DER'],
        createdAfter: '2026-01-01',
      }),
      client.getOrderItems({ amazonOrderId: '123-4567890-1234567' }),
    ]);

    expect(orders.payload.Orders).toHaveLength(1);
    expect(items.payload.OrderItems).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('does not tag outbound config with our internal operation field on the wire', async () => {
    let seenConfig: AxiosRequestConfig | undefined;
    const adapter: AxiosAdapter = async (config) => {
      seenConfig = config;
      return ok(config, ORDERS_PAYLOAD);
    };

    const client = new SpApiClient({
      cacheKey: 'seller-1',
      refreshToken: 'rt',
      credentials: CREDENTIALS,
      httpAdapter: adapter,
    });

    await client.getOrders({
      marketplaceIds: ['ATVPDKIKX0DER'],
      createdAfter: '2026-01-01',
    });

    // The tag is allowed on the in-memory config object (axios-retry needs it
    // for the 429 path), but it must not leak into headers or query params.
    const headers = (seenConfig?.headers ?? {}) as Record<string, string>;
    expect(headers['__spApiOperation']).toBeUndefined();
    const params = (seenConfig?.params ?? {}) as Record<string, string>;
    expect(params['__spApiOperation']).toBeUndefined();
  });
});
