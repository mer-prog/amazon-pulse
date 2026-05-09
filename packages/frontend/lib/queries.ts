/**
 * Read-side queries used by the dashboard. All queries assume the calling
 * context is using the anon key + RLS-restricted to demo sellers.
 *
 * Notes
 *   - We query `sellers_public` (a security_invoker view) instead of the
 *     `sellers` table so the encrypted refresh token column never crosses
 *     the wire even if the policy were misconfigured.
 *   - Marketplace metadata (country/currency) is loaded alongside sellers
 *     so a single round trip populates the dashboard.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface DemoSeller {
  id: string;
  displayName: string;
  sellingPartnerId: string;
  region: string;
  isActive: boolean;
}

export interface SellerMarketplaceRow {
  sellerId: string;
  marketplaceId: string;
  countryCode: string;
  defaultCurrency: string;
  isEnabled: boolean;
}

export interface SyncLogRow {
  id: string;
  sellerId: string;
  marketplaceId: string | null;
  jobRunId: string | null;
  jobType: 'orders' | 'inventory' | 'sales_reports' | 'products';
  status: 'started' | 'succeeded' | 'failed' | 'partial';
  startedAt: string;
  finishedAt: string | null;
  recordsFetched: number | null;
  recordsUpserted: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SellerSummary {
  seller: DemoSeller;
  marketplaces: SellerMarketplaceRow[];
  latestLogs: SyncLogRow[];
}

export async function listDemoSellers(client: SupabaseClient): Promise<DemoSeller[]> {
  const { data, error } = await client
    .from('sellers_public')
    .select('id, display_name, selling_partner_id, region, is_active')
    .order('display_name', { ascending: true });
  if (error) throw new Error(`listDemoSellers: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    displayName: row.display_name as string,
    sellingPartnerId: row.selling_partner_id as string,
    region: row.region as string,
    isActive: row.is_active as boolean,
  }));
}

export async function listSellerMarketplaces(
  client: SupabaseClient,
  sellerIds: readonly string[],
): Promise<SellerMarketplaceRow[]> {
  if (sellerIds.length === 0) return [];
  const { data, error } = await client
    .from('seller_marketplaces')
    .select('seller_id, marketplace_id, country_code, default_currency, is_enabled')
    .in('seller_id', sellerIds);
  if (error) throw new Error(`listSellerMarketplaces: ${error.message}`);
  return (data ?? []).map((row) => ({
    sellerId: row.seller_id as string,
    marketplaceId: row.marketplace_id as string,
    countryCode: row.country_code as string,
    defaultCurrency: row.default_currency as string,
    isEnabled: row.is_enabled as boolean,
  }));
}

export async function listLatestSyncLogs(
  client: SupabaseClient,
  sellerIds: readonly string[],
  limit = 100,
): Promise<SyncLogRow[]> {
  if (sellerIds.length === 0) return [];
  const { data, error } = await client
    .from('sync_logs')
    .select(
      'id, seller_id, marketplace_id, job_run_id, job_type, status, started_at, finished_at, records_fetched, records_upserted, error_code, error_message',
    )
    .in('seller_id', sellerIds)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listLatestSyncLogs: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    sellerId: row.seller_id as string,
    marketplaceId: (row.marketplace_id as string | null) ?? null,
    jobRunId: (row.job_run_id as string | null) ?? null,
    jobType: row.job_type as SyncLogRow['jobType'],
    status: row.status as SyncLogRow['status'],
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    recordsFetched: (row.records_fetched as number | null) ?? null,
    recordsUpserted: (row.records_upserted as number | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  }));
}

export async function loadDashboardSummary(client: SupabaseClient): Promise<SellerSummary[]> {
  const sellers = await listDemoSellers(client);
  if (sellers.length === 0) return [];
  const sellerIds = sellers.map((s) => s.id);
  const [marketplaces, logs] = await Promise.all([
    listSellerMarketplaces(client, sellerIds),
    listLatestSyncLogs(client, sellerIds, 200),
  ]);

  const byMpSeller = new Map<string, SellerMarketplaceRow[]>();
  for (const m of marketplaces) {
    const list = byMpSeller.get(m.sellerId) ?? [];
    list.push(m);
    byMpSeller.set(m.sellerId, list);
  }
  const byLogSeller = new Map<string, SyncLogRow[]>();
  for (const l of logs) {
    const list = byLogSeller.get(l.sellerId) ?? [];
    list.push(l);
    byLogSeller.set(l.sellerId, list);
  }

  return sellers.map((seller) => ({
    seller,
    marketplaces: byMpSeller.get(seller.id) ?? [],
    latestLogs: byLogSeller.get(seller.id) ?? [],
  }));
}
