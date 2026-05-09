/**
 * Shared building blocks for cron handlers:
 *
 *   - Loading the active seller list (with their enabled marketplaces).
 *   - Building a per-region SpApiClient factory bound to a single seller's
 *     decrypted refresh token.
 *
 * Each handler then plugs these into `runMarketplaceBatch` from the pipeline
 * — region grouping, partial failure isolation, and sync_logs writes are all
 * inherited from there.
 */

import {
  SpApiClient,
  getSellerCredentials,
  getServiceClient,
  type LwaCredentials,
  type SpApiRegion,
} from '@amazon-pulse/pipeline';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CronEnv } from '../env.js';

export interface ActiveSeller {
  sellerId: string;
  marketplaceIds: string[];
}

/**
 * Returns one entry per active seller along with the marketplace IDs we
 * should sync. A seller with zero enabled marketplaces is skipped.
 *
 * The cron Worker uses the service-role Supabase client (bypasses RLS) so
 * it sees every seller, demo or real. The demo-only RLS policy added in
 * migration 0003 is irrelevant here.
 */
export async function loadActiveSellers(supabase: SupabaseClient): Promise<ActiveSeller[]> {
  const { data, error } = await supabase
    .from('sellers')
    .select('id, is_active, seller_marketplaces!inner(marketplace_id, is_enabled)')
    .eq('is_active', true);
  if (error) {
    throw new Error(`loadActiveSellers: ${error.message}`);
  }
  type Row = {
    id: string;
    seller_marketplaces: Array<{ marketplace_id: string; is_enabled: boolean }>;
  };
  return ((data ?? []) as Row[])
    .map((row) => ({
      sellerId: row.id,
      marketplaceIds: (row.seller_marketplaces ?? [])
        .filter((m) => m.is_enabled)
        .map((m) => m.marketplace_id),
    }))
    .filter((s) => s.marketplaceIds.length > 0);
}

export function makeLwaCredentials(env: CronEnv): LwaCredentials {
  return {
    clientId: env.SP_API_CLIENT_ID,
    clientSecret: env.SP_API_CLIENT_SECRET,
  };
}

export function isProduction(env: CronEnv): boolean {
  return env.SP_API_PRODUCTION === 'true';
}

/**
 * Build a `clientForRegion` factory pinned to a single seller's refresh
 * token. The factory is intended to be passed into `runMarketplaceBatch`,
 * which caches the per-region client across the batch.
 */
export async function buildClientFactory(
  env: CronEnv,
  sellerId: string,
): Promise<(region: SpApiRegion) => SpApiClient> {
  const creds = await getSellerCredentials(sellerId);
  const lwa = makeLwaCredentials(env);
  const production = isProduction(env);
  return (region) =>
    new SpApiClient({
      region,
      production,
      // Cache key namespaces the LWA access token + the rate-limit buckets
      // per (seller, region). Two regions for the same seller will hold
      // independent buckets, which is what we want — see rate-limits.ts.
      cacheKey: `${sellerId}:${region}`,
      refreshToken: creds.refreshToken,
      credentials: lwa,
    });
}

export function getSupabase(): SupabaseClient {
  // Reuse the cached service-role client. populateProcessEnv() must have
  // been called by the entry handler so the env vars are visible.
  return getServiceClient();
}

/**
 * Compute a sliding "since when" window for incremental syncs. We pick a
 * window slightly larger than the cron cadence to absorb late-arriving
 * Amazon updates (LastUpdateDate occasionally lags the actual purchase).
 */
export function isoSinceMinutes(minutesAgo: number, now: Date = new Date()): string {
  return new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString();
}

/**
 * Compute the YYYY-MM-DD calendar date `daysAgo` days before `now` (UTC).
 */
export function isoDate(daysAgo: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}
