/**
 * Inventory sync worker.
 *
 * SP-API: GET /fba/inventory/v1/summaries (paginated via pagination.nextToken)
 * Idempotency: UNIQUE (seller_id, marketplace_id, sku) + Supabase upsert.
 */

import type { SpApiClient } from '../lib/sp-api-client.js';
import {
  runMarketplaceSync,
  type MarketplaceSyncResult,
  type SyncContext,
} from '../lib/sync-helpers.js';
import type { InventorySummary } from '../schemas/inventory.js';

export interface InventorySyncContext extends SyncContext {
  client: SpApiClient;
}

const INVENTORY_CONFLICT_TARGET = 'seller_id,marketplace_id,sku';

interface InventoryRow {
  seller_id: string;
  marketplace_id: string;
  sku: string;
  asin: string | null;
  fulfillable_quantity: number;
  inbound_working_quantity: number;
  inbound_shipped_quantity: number;
  inbound_receiving_quantity: number;
  reserved_quantity: number;
  unfulfillable_quantity: number;
  total_quantity: number;
  raw: InventorySummary;
  updated_at: string | null;
  synced_at: string;
}

function toInventoryRow(
  s: InventorySummary,
  sellerId: string,
  marketplaceId: string,
  syncedAt: string,
): InventoryRow {
  const d = s.inventoryDetails;
  return {
    seller_id: sellerId,
    marketplace_id: marketplaceId,
    sku: s.sellerSku,
    asin: s.asin ?? null,
    fulfillable_quantity: d?.fulfillableQuantity ?? 0,
    inbound_working_quantity: d?.inboundWorkingQuantity ?? 0,
    inbound_shipped_quantity: d?.inboundShippedQuantity ?? 0,
    inbound_receiving_quantity: d?.inboundReceivingQuantity ?? 0,
    reserved_quantity: d?.reservedQuantity?.totalReservedQuantity ?? 0,
    unfulfillable_quantity: d?.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0,
    total_quantity: s.totalQuantity ?? 0,
    raw: s,
    updated_at: s.lastUpdatedTime ?? null,
    synced_at: syncedAt,
  };
}

export async function syncInventoryForMarketplace(
  ctx: InventorySyncContext,
  sellerId: string,
  marketplaceId: string,
): Promise<MarketplaceSyncResult> {
  return runMarketplaceSync(
    ctx,
    { sellerId, marketplaceId, jobType: 'inventory' },
    async (counters) => {
      const syncedAt = new Date().toISOString();
      let nextToken: string | undefined;
      do {
        const resp = await ctx.client.getInventorySummaries({
          marketplaceIds: [marketplaceId],
          details: true,
          nextToken,
        });
        const summaries = resp.payload.inventorySummaries;
        counters.fetched += summaries.length;
        if (summaries.length > 0) {
          const rows = summaries.map((s) => toInventoryRow(s, sellerId, marketplaceId, syncedAt));
          const { error } = await ctx.supabase
            .from('inventory')
            .upsert(rows, { onConflict: INVENTORY_CONFLICT_TARGET });
          if (error) throw new Error(`inventory upsert failed: ${error.message}`);
          counters.upserted += rows.length;
        }
        nextToken = resp.pagination?.nextToken;
      } while (nextToken);
    },
  );
}

export async function syncInventoryForSeller(
  ctx: InventorySyncContext,
  sellerId: string,
  marketplaceIds: string[],
): Promise<MarketplaceSyncResult[]> {
  const results: MarketplaceSyncResult[] = [];
  for (const m of marketplaceIds) {
    results.push(await syncInventoryForMarketplace(ctx, sellerId, m));
  }
  return results;
}
