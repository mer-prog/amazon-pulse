import { describe, it, expect, vi } from 'vitest';
import { FakeSupabase } from './_mocks.js';
import { syncProductsForMarketplace } from '../../src/workers/sync-products.js';
import { newJobRunId } from '../../src/lib/sync-helpers.js';
import type { SearchCatalogItemsResponse } from '../../src/schemas/catalog.js';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';
const MARKETPLACE_ID = 'A1F83G8C2ARO7P';

function buildContext() {
  const supabase = new FakeSupabase();
  // Pre-populate inventory so the products worker has ASINs to look up.
  supabase.table('inventory').insert([
    {
      seller_id: SELLER_ID,
      marketplace_id: MARKETPLACE_ID,
      sku: 'DEMO-SKU-UK-001',
      asin: 'B0FAKE10001',
    },
    {
      seller_id: SELLER_ID,
      marketplace_id: MARKETPLACE_ID,
      sku: 'DEMO-SKU-UK-002',
      asin: 'B0FAKE10002',
    },
  ]);
  const client = { searchCatalogItems: vi.fn() };
  const ctx = {
    supabase: supabase.asSupabaseClient(),
    client: client as unknown as import('../../src/lib/sp-api-client.js').SpApiClient,
    jobRunId: newJobRunId(),
  };
  return { supabase, client, ctx };
}

function buildCatalogResp(asins: string[]): SearchCatalogItemsResponse {
  return {
    items: asins.map((asin) => ({
      asin,
      summaries: [
        {
          marketplaceId: MARKETPLACE_ID,
          asin,
          brand: 'NorthernKettle',
          itemName: `Catalog Title for ${asin}`,
        },
      ],
      images: [
        {
          marketplaceId: MARKETPLACE_ID,
          images: [
            { variant: 'MAIN', link: `https://m.media-amazon.com/images/I/${asin}.jpg` },
          ],
        },
      ],
    })),
  };
}

describe('syncProductsForMarketplace', () => {
  it('enriches products via catalog and upserts one row per known SKU', async () => {
    const { supabase, client, ctx } = buildContext();
    client.searchCatalogItems.mockResolvedValueOnce(
      buildCatalogResp(['B0FAKE10001', 'B0FAKE10002']),
    );
    const result = await syncProductsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(result.status).toBe('succeeded');
    expect(result.recordsUpserted).toBe(2);
    const rows = supabase.table('products').rows;
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r['title']).sort();
    expect(titles).toEqual(['Catalog Title for B0FAKE10001', 'Catalog Title for B0FAKE10002']);
  });

  it('is a no-op (succeeded, 0 records) when inventory has no ASINs yet', async () => {
    const supabase = new FakeSupabase();
    const client = { searchCatalogItems: vi.fn() };
    const ctx = {
      supabase: supabase.asSupabaseClient(),
      client: client as unknown as import('../../src/lib/sp-api-client.js').SpApiClient,
      jobRunId: newJobRunId(),
    };
    const result = await syncProductsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(result.status).toBe('succeeded');
    expect(result.recordsFetched).toBe(0);
    expect(client.searchCatalogItems).not.toHaveBeenCalled();
  });

  it('is idempotent across runs', async () => {
    const { supabase, client, ctx } = buildContext();
    client.searchCatalogItems
      .mockResolvedValueOnce(buildCatalogResp(['B0FAKE10001', 'B0FAKE10002']))
      .mockResolvedValueOnce(buildCatalogResp(['B0FAKE10001', 'B0FAKE10002']));
    await syncProductsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    await syncProductsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID);
    expect(supabase.table('products').rows).toHaveLength(2);
  });

  it('batches ASIN lookups to the configured batch size', async () => {
    const supabase = new FakeSupabase();
    const inventoryTable = supabase.table('inventory');
    for (let i = 0; i < 25; i += 1) {
      inventoryTable.insert([
        {
          seller_id: SELLER_ID,
          marketplace_id: MARKETPLACE_ID,
          sku: `SKU-${i}`,
          asin: `B0FAKE${String(i).padStart(5, '0')}`,
        },
      ]);
    }
    const client = { searchCatalogItems: vi.fn() };
    client.searchCatalogItems.mockImplementation(
      ({ identifiers }: { identifiers: string[] }) =>
        Promise.resolve(buildCatalogResp(identifiers)),
    );
    const ctx = {
      supabase: supabase.asSupabaseClient(),
      client: client as unknown as import('../../src/lib/sp-api-client.js').SpApiClient,
      jobRunId: newJobRunId(),
    };
    await syncProductsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, { batchSize: 10 });
    expect(client.searchCatalogItems).toHaveBeenCalledTimes(3); // 10 + 10 + 5
    expect(supabase.table('products').rows).toHaveLength(25);
  });
});
