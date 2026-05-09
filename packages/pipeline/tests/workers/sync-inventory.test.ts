import { describe, it, expect, vi } from 'vitest';
import { FakeSupabase } from './_mocks.js';
import { syncInventoryForMarketplace } from '../../src/workers/sync-inventory.js';
import { newJobRunId } from '../../src/lib/sync-helpers.js';
import type { GetInventorySummariesResponse } from '../../src/schemas/inventory.js';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';
const MARKETPLACE_ID = 'A1PA6795UKMFR9';

function buildInvResp(
  skus: Array<{ sku: string; asin?: string; total: number; fulfillable: number }>,
  nextToken?: string,
): GetInventorySummariesResponse {
  return {
    payload: {
      inventorySummaries: skus.map((s) => ({
        sellerSku: s.sku,
        asin: s.asin ?? `B0FAKE-${s.sku}`,
        totalQuantity: s.total,
        lastUpdatedTime: '2026-05-08T03:00:00Z',
        inventoryDetails: {
          fulfillableQuantity: s.fulfillable,
          inboundShippedQuantity: 0,
          reservedQuantity: { totalReservedQuantity: 0 },
          unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
        },
      })),
    },
    ...(nextToken ? { pagination: { nextToken } } : {}),
  };
}

function buildContext() {
  const supabase = new FakeSupabase();
  const client = { getInventorySummaries: vi.fn() };
  const ctx = {
    supabase: supabase.asSupabaseClient(),
    client: client as unknown as import('../../src/lib/sp-api-client.js').SpApiClient,
    jobRunId: newJobRunId(),
  };
  return { supabase, client, ctx };
}

describe('syncInventoryForMarketplace', () => {
  it('upserts FBA inventory rows and logs success', async () => {
    const { supabase, client, ctx } = buildContext();
    client.getInventorySummaries.mockResolvedValueOnce(
      buildInvResp([
        { sku: 'SKU-A', total: 100, fulfillable: 80 },
        { sku: 'SKU-B', total: 50, fulfillable: 40 },
      ]),
    );
    const result = await syncInventoryForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(result.status).toBe('succeeded');
    expect(result.recordsFetched).toBe(2);
    expect(supabase.table('inventory').rows).toHaveLength(2);
    expect(supabase.table('sync_logs').rows[0]!['status']).toBe('succeeded');
  });

  it('paginates via pagination.nextToken', async () => {
    const { supabase, client, ctx } = buildContext();
    client.getInventorySummaries
      .mockResolvedValueOnce(buildInvResp([{ sku: 'A', total: 1, fulfillable: 1 }], 'tok'))
      .mockResolvedValueOnce(buildInvResp([{ sku: 'B', total: 2, fulfillable: 2 }]));
    await syncInventoryForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(client.getInventorySummaries).toHaveBeenCalledTimes(2);
    expect(supabase.table('inventory').rows).toHaveLength(2);
  });

  it('is idempotent across runs', async () => {
    const { supabase, client, ctx } = buildContext();
    const payload = buildInvResp([{ sku: 'IDEMP', total: 5, fulfillable: 5 }]);
    client.getInventorySummaries.mockResolvedValueOnce(payload);
    await syncInventoryForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    client.getInventorySummaries.mockResolvedValueOnce(payload);
    await syncInventoryForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(supabase.table('inventory').rows).toHaveLength(1);
  });

  it('logs failed status when the SP-API call throws', async () => {
    const { supabase, client, ctx } = buildContext();
    client.getInventorySummaries.mockRejectedValueOnce(new Error('500 internal'));
    const result = await syncInventoryForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(result.status).toBe('failed');
    expect(supabase.table('sync_logs').rows[0]!['error_message']).toContain('500');
  });
});
