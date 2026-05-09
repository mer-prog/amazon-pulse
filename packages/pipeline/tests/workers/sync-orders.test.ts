import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeSupabase } from './_mocks.js';
import { syncOrdersForMarketplace } from '../../src/workers/sync-orders.js';
import { newJobRunId } from '../../src/lib/sync-helpers.js';
import type { GetOrdersResponse, GetOrderItemsResponse } from '../../src/schemas/orders.js';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';
const MARKETPLACE_ID = 'A1F83G8C2ARO7P';

function buildOrdersResp(orders: Array<{ id: string; sku?: string }>, nextToken?: string): GetOrdersResponse {
  return {
    payload: {
      Orders: orders.map((o) => ({
        AmazonOrderId: o.id,
        PurchaseDate: '2026-05-08T10:00:00Z',
        LastUpdateDate: '2026-05-08T11:00:00Z',
        OrderStatus: 'Shipped',
        OrderTotal: { CurrencyCode: 'GBP', Amount: '14.50' },
        NumberOfItemsShipped: 1,
        MarketplaceId: MARKETPLACE_ID,
      })),
      ...(nextToken ? { NextToken: nextToken } : {}),
    },
  };
}

function buildOrderItemsResp(orderId: string, sku: string): GetOrderItemsResponse {
  return {
    payload: {
      AmazonOrderId: orderId,
      OrderItems: [
        {
          OrderItemId: `ITEM-${orderId}`,
          ASIN: 'B0FAKE10001',
          SellerSKU: sku,
          Title: 'Demo Item',
          QuantityOrdered: 1,
          QuantityShipped: 1,
          ItemPrice: { CurrencyCode: 'GBP', Amount: '14.50' },
        },
      ],
    },
  };
}

function buildContext() {
  const supabase = new FakeSupabase();
  const client = {
    getOrders: vi.fn(),
    getOrderItems: vi.fn(),
  };
  const ctx = {
    supabase: supabase.asSupabaseClient(),
    client: client as unknown as import('../../src/lib/sp-api-client.js').SpApiClient,
    jobRunId: newJobRunId(),
  };
  return { supabase, client, ctx };
}

describe('syncOrdersForMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts orders + order_items and writes a succeeded sync_logs row', async () => {
    const { supabase, client, ctx } = buildContext();
    client.getOrders.mockResolvedValueOnce(
      buildOrdersResp([{ id: '203-ABC-001' }, { id: '203-ABC-002' }]),
    );
    client.getOrderItems.mockImplementation(({ amazonOrderId }: { amazonOrderId: string }) =>
      Promise.resolve(buildOrderItemsResp(amazonOrderId, 'DEMO-SKU-UK-001')),
    );

    const result = await syncOrdersForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      createdAfter: '2026-05-01T00:00:00Z',
    });

    expect(result.status).toBe('succeeded');
    expect(result.recordsFetched).toBe(4); // 2 orders + 2 items
    expect(result.recordsUpserted).toBe(4);
    expect(supabase.table('orders').rows).toHaveLength(2);
    expect(supabase.table('order_items').rows).toHaveLength(2);

    const log = supabase.table('sync_logs').rows[0]!;
    expect(log['status']).toBe('succeeded');
    expect(log['job_type']).toBe('orders');
    expect(log['marketplace_id']).toBe(MARKETPLACE_ID);
    expect(log['job_run_id']).toBe(ctx.jobRunId);
  });

  it('follows NextToken pagination across multiple pages', async () => {
    const { supabase, client, ctx } = buildContext();
    client.getOrders
      .mockResolvedValueOnce(buildOrdersResp([{ id: 'P1-1' }, { id: 'P1-2' }], 'tok-2'))
      .mockResolvedValueOnce(buildOrdersResp([{ id: 'P2-1' }]));
    client.getOrderItems.mockImplementation(({ amazonOrderId }: { amazonOrderId: string }) =>
      Promise.resolve(buildOrderItemsResp(amazonOrderId, 'DEMO-SKU-UK-001')),
    );

    await syncOrdersForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      createdAfter: '2026-05-01T00:00:00Z',
    });

    expect(client.getOrders).toHaveBeenCalledTimes(2);
    expect(supabase.table('orders').rows).toHaveLength(3);
  });

  it('is idempotent: running twice with the same payload does not duplicate rows', async () => {
    const { supabase, client, ctx } = buildContext();
    const setup = (): void => {
      client.getOrders.mockResolvedValueOnce(buildOrdersResp([{ id: '203-IDEMP' }]));
      client.getOrderItems.mockResolvedValueOnce(buildOrderItemsResp('203-IDEMP', 'DEMO-SKU-UK-001'));
    };
    setup();
    await syncOrdersForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      createdAfter: '2026-05-01T00:00:00Z',
    });
    setup();
    await syncOrdersForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      createdAfter: '2026-05-01T00:00:00Z',
    });
    expect(supabase.table('orders').rows).toHaveLength(1);
    expect(supabase.table('order_items').rows).toHaveLength(1);
  });

  it('records a failed sync_logs row when the SP-API call throws', async () => {
    const { supabase, client, ctx } = buildContext();
    client.getOrders.mockRejectedValueOnce(new Error('429 throttled'));
    const result = await syncOrdersForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      createdAfter: '2026-05-01T00:00:00Z',
    });
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('429');
    const log = supabase.table('sync_logs').rows[0]!;
    expect(log['status']).toBe('failed');
    expect(log['error_message']).toContain('429');
  });
});
