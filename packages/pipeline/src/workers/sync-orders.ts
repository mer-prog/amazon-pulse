/**
 * Orders sync worker.
 *
 *   getOrders (paginated via NextToken)
 *     └─ for each order:  upsert into `orders`
 *                          + getOrderItems (paginated)
 *                          + upsert into `order_items`
 *
 * Idempotency is delegated to the database UNIQUE constraints
 *   orders          : (marketplace_id, amazon_order_id)
 *   order_items     : (order_id, order_item_id)
 * combined with Supabase upsert(onConflict=...).
 *
 * One sync_logs row is emitted per (seller, marketplace) and tagged with
 * the orchestrator's job_run_id so partial failures stay observable.
 */

import type { SpApiClient } from '../lib/sp-api-client.js';
import {
  runMarketplaceSync,
  type MarketplaceSyncResult,
  type SyncContext,
} from '../lib/sync-helpers.js';
import type { Order, OrderItem } from '../schemas/orders.js';

export interface OrdersSyncOptions {
  /** ISO-8601 timestamp; required by SP-API getOrders. */
  createdAfter: string;
  /** Page size hint; SP-API caps at 100. */
  maxResultsPerPage?: number;
}

export interface OrdersSyncContext extends SyncContext {
  client: SpApiClient;
}

const ORDERS_CONFLICT_TARGET = 'marketplace_id,amazon_order_id';
const ORDER_ITEMS_CONFLICT_TARGET = 'order_id,order_item_id';

interface OrderRow {
  seller_id: string;
  marketplace_id: string;
  amazon_order_id: string;
  purchase_date: string;
  updated_at: string | null;
  order_status: string;
  fulfillment_channel: string | null;
  sales_channel: string | null;
  order_total_amount: number | null;
  order_total_currency: string | null;
  number_of_items_shipped: number | null;
  number_of_items_unshipped: number | null;
  buyer_email: string | null;
  ship_country: string | null;
  is_premium_order: boolean | null;
  is_business_order: boolean | null;
  raw: Order;
  synced_at: string;
}

interface OrderItemRow {
  order_id: string;
  order_item_id: string;
  seller_id: string;
  sku: string;
  asin: string | null;
  title: string | null;
  quantity_ordered: number;
  quantity_shipped: number | null;
  item_price_amount: number | null;
  item_price_currency: string | null;
  item_tax_amount: number | null;
  shipping_price_amount: number | null;
  promotion_discount: number | null;
  raw: OrderItem;
}

function parseMoneyAmount(amount: string | undefined): number | null {
  if (amount === undefined) return null;
  const n = Number.parseFloat(amount);
  return Number.isFinite(n) ? n : null;
}

function toOrderRow(o: Order, sellerId: string, marketplaceId: string, syncedAt: string): OrderRow {
  return {
    seller_id: sellerId,
    marketplace_id: o.MarketplaceId ?? marketplaceId,
    amazon_order_id: o.AmazonOrderId,
    purchase_date: o.PurchaseDate,
    updated_at: o.LastUpdateDate ?? null,
    order_status: o.OrderStatus,
    fulfillment_channel: o.FulfillmentChannel ?? null,
    sales_channel: o.SalesChannel ?? null,
    order_total_amount: parseMoneyAmount(o.OrderTotal?.Amount),
    order_total_currency: o.OrderTotal?.CurrencyCode ?? null,
    number_of_items_shipped: o.NumberOfItemsShipped ?? null,
    number_of_items_unshipped: o.NumberOfItemsUnshipped ?? null,
    buyer_email: o.BuyerInfo?.BuyerEmail ?? null,
    ship_country: o.ShippingAddress?.CountryCode ?? null,
    is_premium_order: o.IsPremiumOrder ?? null,
    is_business_order: o.IsBusinessOrder ?? null,
    raw: o,
    synced_at: syncedAt,
  };
}

function toOrderItemRow(item: OrderItem, orderDbId: string, sellerId: string): OrderItemRow | null {
  const sku = item.SellerSKU;
  if (!sku) return null;
  return {
    order_id: orderDbId,
    order_item_id: item.OrderItemId,
    seller_id: sellerId,
    sku,
    asin: item.ASIN ?? null,
    title: item.Title ?? null,
    quantity_ordered: item.QuantityOrdered,
    quantity_shipped: item.QuantityShipped ?? null,
    item_price_amount: parseMoneyAmount(item.ItemPrice?.Amount),
    item_price_currency: item.ItemPrice?.CurrencyCode ?? null,
    item_tax_amount: parseMoneyAmount(item.ItemTax?.Amount),
    shipping_price_amount: parseMoneyAmount(item.ShippingPrice?.Amount),
    promotion_discount: parseMoneyAmount(item.PromotionDiscount?.Amount),
    raw: item,
  };
}

export async function syncOrdersForMarketplace(
  ctx: OrdersSyncContext,
  sellerId: string,
  marketplaceId: string,
  opts: OrdersSyncOptions,
): Promise<MarketplaceSyncResult> {
  return runMarketplaceSync(
    ctx,
    { sellerId, marketplaceId, jobType: 'orders' },
    async (counters) => {
      const syncedAt = new Date().toISOString();
      let nextToken: string | undefined;

      do {
        const resp = await ctx.client.getOrders({
          marketplaceIds: [marketplaceId],
          createdAfter: opts.createdAfter,
          maxResultsPerPage: opts.maxResultsPerPage ?? 100,
          nextToken,
        });
        const orders = resp.payload.Orders;
        counters.fetched += orders.length;

        if (orders.length > 0) {
          const orderRows = orders.map((o) => toOrderRow(o, sellerId, marketplaceId, syncedAt));
          const { data: upsertedOrders, error: ordersErr } = await ctx.supabase
            .from('orders')
            .upsert(orderRows, { onConflict: ORDERS_CONFLICT_TARGET })
            .select('id, amazon_order_id, marketplace_id');
          if (ordersErr) throw new Error(`orders upsert failed: ${ordersErr.message}`);
          counters.upserted += orderRows.length;

          const orderIdByAmazonId = new Map<string, string>();
          for (const row of (upsertedOrders ?? []) as Array<{
            id: string;
            amazon_order_id: string;
          }>) {
            orderIdByAmazonId.set(row.amazon_order_id, row.id);
          }

          for (const o of orders) {
            const orderDbId = orderIdByAmazonId.get(o.AmazonOrderId);
            if (!orderDbId) continue;
            await syncOrderItemsForOrder(ctx, sellerId, o.AmazonOrderId, orderDbId, counters);
          }
        }

        nextToken = resp.payload.NextToken;
      } while (nextToken);
    },
  );
}

async function syncOrderItemsForOrder(
  ctx: OrdersSyncContext,
  sellerId: string,
  amazonOrderId: string,
  orderDbId: string,
  counters: { fetched: number; upserted: number },
): Promise<void> {
  let itemsNextToken: string | undefined;
  do {
    const itemsResp = await ctx.client.getOrderItems({
      amazonOrderId,
      nextToken: itemsNextToken,
    });
    const items = itemsResp.payload.OrderItems;
    counters.fetched += items.length;
    const rows = items
      .map((it) => toOrderItemRow(it, orderDbId, sellerId))
      .filter((r): r is OrderItemRow => r !== null);
    if (rows.length > 0) {
      const { error } = await ctx.supabase
        .from('order_items')
        .upsert(rows, { onConflict: ORDER_ITEMS_CONFLICT_TARGET });
      if (error) throw new Error(`order_items upsert failed: ${error.message}`);
      counters.upserted += rows.length;
    }
    itemsNextToken = itemsResp.payload.NextToken;
  } while (itemsNextToken);
}

export async function syncOrdersForSeller(
  ctx: OrdersSyncContext,
  sellerId: string,
  marketplaceIds: string[],
  opts: OrdersSyncOptions,
): Promise<MarketplaceSyncResult[]> {
  const results: MarketplaceSyncResult[] = [];
  for (const marketplaceId of marketplaceIds) {
    results.push(await syncOrdersForMarketplace(ctx, sellerId, marketplaceId, opts));
  }
  return results;
}
