/**
 * SP-API Sandbox integration test for getOrders.
 *
 * Hits the EU static sandbox endpoint to verify that:
 *   1. LWA refresh-token exchange works end-to-end
 *   2. The x-amz-access-token header authenticates correctly
 *   3. The response payload parses against our zod schema
 *
 * Auto-skips when SP-API credentials aren't present in the environment so
 * CI stays green without secrets configured.
 */

import { describe, it, expect } from 'vitest';
import { SpApiClient } from '../../src/lib/sp-api-client.js';
import { _clearTokenCache } from '../../src/lib/lwa-auth.js';

const REQUIRED_ENV = ['SP_API_CLIENT_ID', 'SP_API_CLIENT_SECRET', 'SP_API_REFRESH_TOKEN'] as const;
const SKIP = REQUIRED_ENV.some((k) => !process.env[k]);

const SANDBOX_EU = 'https://sandbox.sellingpartnerapi-eu.amazon.com';

// The static sandbox returns canned mock data when called with the canonical
// test-case parameters defined in Amazon's request templates.
const STATIC_TEST_MARKETPLACE = 'ATVPDKIKX0DER';
const STATIC_TEST_CREATED_AFTER = 'TEST_CASE_200';

describe.skipIf(SKIP)('SP-API sandbox: getOrders', () => {
  it('returns a parsable orders payload from the static sandbox', async () => {
    _clearTokenCache();

    const client = new SpApiClient({
      endpoint: process.env.SP_API_ENDPOINT ?? SANDBOX_EU,
      cacheKey: 'integration-test',
      refreshToken: process.env.SP_API_REFRESH_TOKEN as string,
      credentials: {
        clientId: process.env.SP_API_CLIENT_ID as string,
        clientSecret: process.env.SP_API_CLIENT_SECRET as string,
      },
    });

    const resp = await client.getOrders({
      marketplaceIds: [STATIC_TEST_MARKETPLACE],
      createdAfter: STATIC_TEST_CREATED_AFTER,
    });

    expect(resp.payload).toBeDefined();
    expect(Array.isArray(resp.payload.Orders)).toBe(true);
  });
});
