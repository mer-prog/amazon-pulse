/**
 * Products sync worker.
 *
 * Strategy: pull a list of distinct ASINs we already know about (from the
 * inventory table for this seller + marketplace) and call SP-API
 * searchCatalogItems to enrich them — title, brand, image, etc.
 *
 * If inventory hasn't been synced yet, this worker is a no-op for that
 * marketplace; it logs status='succeeded' with 0 records. Once inventory
 * data exists the next run will populate `products`.
 *
 * Idempotency: UNIQUE (seller_id, marketplace_id, sku) + Supabase upsert.
 * (We carry the sellerSku from inventory so each catalog hit becomes one row
 * keyed by SKU.)
 */

import type { SpApiClient } from '../lib/sp-api-client.js';
import {
  runMarketplaceSync,
  type MarketplaceSyncResult,
  type SyncContext,
} from '../lib/sync-helpers.js';
import type { CatalogItem } from '../schemas/catalog.js';

export interface ProductsSyncContext extends SyncContext {
  client: SpApiClient;
}

export interface ProductsSyncOptions {
  /** Catalog API allows up to 20 identifiers per request. */
  batchSize?: number;
}

const PRODUCTS_CONFLICT_TARGET = 'seller_id,marketplace_id,sku';
const DEFAULT_BATCH_SIZE = 20;

interface ProductRow {
  seller_id: string;
  marketplace_id: string;
  sku: string;
  asin: string | null;
  title: string | null;
  brand: string | null;
  list_price: number | null;
  currency: string | null;
  image_url: string | null;
  status: 'active' | 'inactive' | 'incomplete' | 'suppressed' | null;
  raw: CatalogItem;
  updated_at: string | null;
  synced_at: string;
}

function pickSummary(item: CatalogItem, marketplaceId: string) {
  return item.summaries?.find((s) => s.marketplaceId === marketplaceId) ?? item.summaries?.[0];
}

function pickImageUrl(item: CatalogItem, marketplaceId: string): string | null {
  const block =
    item.images?.find((b) => b.marketplaceId === marketplaceId) ?? item.images?.[0];
  if (!block) return null;
  const main = block.images.find((i) => i.variant === 'MAIN') ?? block.images[0];
  return main?.link ?? null;
}

function toProductRow(
  item: CatalogItem,
  sellerId: string,
  marketplaceId: string,
  sku: string,
  syncedAt: string,
): ProductRow {
  const summary = pickSummary(item, marketplaceId);
  return {
    seller_id: sellerId,
    marketplace_id: marketplaceId,
    sku,
    asin: item.asin,
    title: summary?.itemName ?? null,
    brand: summary?.brand ?? null,
    list_price: null,
    currency: null,
    image_url: pickImageUrl(item, marketplaceId),
    status: 'active',
    raw: item,
    updated_at: null,
    synced_at: syncedAt,
  };
}

interface AsinSku {
  asin: string;
  sku: string;
}

async function loadKnownAsinsForMarketplace(
  ctx: ProductsSyncContext,
  sellerId: string,
  marketplaceId: string,
): Promise<AsinSku[]> {
  const { data, error } = await ctx.supabase
    .from('inventory')
    .select('sku, asin')
    .eq('seller_id', sellerId)
    .eq('marketplace_id', marketplaceId)
    .not('asin', 'is', null);
  if (error) throw new Error(`failed to read inventory ASINs: ${error.message}`);
  const out: AsinSku[] = [];
  for (const row of (data ?? []) as Array<{ sku: string; asin: string | null }>) {
    if (row.asin) out.push({ asin: row.asin, sku: row.sku });
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function syncProductsForMarketplace(
  ctx: ProductsSyncContext,
  sellerId: string,
  marketplaceId: string,
  opts: ProductsSyncOptions = {},
): Promise<MarketplaceSyncResult> {
  return runMarketplaceSync(
    ctx,
    { sellerId, marketplaceId, jobType: 'products' },
    async (counters) => {
      const known = await loadKnownAsinsForMarketplace(ctx, sellerId, marketplaceId);
      if (known.length === 0) return;

      const skuByAsin = new Map<string, string>();
      for (const k of known) skuByAsin.set(k.asin, k.sku);

      const batches = chunk(
        Array.from(skuByAsin.keys()),
        opts.batchSize ?? DEFAULT_BATCH_SIZE,
      );
      const syncedAt = new Date().toISOString();

      for (const asinBatch of batches) {
        const resp = await ctx.client.searchCatalogItems({
          marketplaceIds: [marketplaceId],
          identifiers: asinBatch,
          identifiersType: 'ASIN',
          includedData: ['summaries', 'images'],
        });
        counters.fetched += resp.items.length;
        if (resp.items.length === 0) continue;

        const rows: ProductRow[] = [];
        for (const item of resp.items) {
          const sku = skuByAsin.get(item.asin);
          if (!sku) continue;
          rows.push(toProductRow(item, sellerId, marketplaceId, sku, syncedAt));
        }
        if (rows.length > 0) {
          const { error } = await ctx.supabase
            .from('products')
            .upsert(rows, { onConflict: PRODUCTS_CONFLICT_TARGET });
          if (error) throw new Error(`products upsert failed: ${error.message}`);
          counters.upserted += rows.length;
        }
      }
    },
  );
}

export async function syncProductsForSeller(
  ctx: ProductsSyncContext,
  sellerId: string,
  marketplaceIds: string[],
  opts: ProductsSyncOptions = {},
): Promise<MarketplaceSyncResult[]> {
  const results: MarketplaceSyncResult[] = [];
  for (const m of marketplaceIds) {
    results.push(await syncProductsForMarketplace(ctx, sellerId, m, opts));
  }
  return results;
}
