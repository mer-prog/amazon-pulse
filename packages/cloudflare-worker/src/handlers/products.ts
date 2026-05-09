import {
  newJobRunId,
  runMarketplaceBatch,
  syncProductsForMarketplace,
  type MarketplaceSyncResult,
  type SpApiRegion,
  type SpApiClient,
} from '@amazon-pulse/pipeline';
import {
  buildClientFactory,
  getSupabase,
  loadActiveSellers,
} from './shared.js';
import type { CronEnv } from '../env.js';

/**
 * Cron: weekly, Sundays at 00:00 UTC. Refreshes the catalog snapshot
 * (titles, brand, list_price) for every seller × marketplace.
 */
export async function runProductsCron(env: CronEnv): Promise<MarketplaceSyncResult[]> {
  const supabase = getSupabase();
  const sellers = await loadActiveSellers(supabase);
  if (sellers.length === 0) return [];

  const all: MarketplaceSyncResult[] = [];
  const jobRunId = newJobRunId();

  for (const s of sellers) {
    try {
      const clientFactory = await buildClientFactory(env, s.sellerId);
      const ctx = { supabase, jobRunId };
      const results = await runMarketplaceBatch<SpApiClient>(
        ctx,
        s.sellerId,
        s.marketplaceIds,
        'products',
        (region: SpApiRegion) => clientFactory(region),
        (c, client, sellerId, marketplaceId) =>
          syncProductsForMarketplace({ ...c, client }, sellerId, marketplaceId),
      );
      all.push(...results);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cron:products] seller ${s.sellerId} aborted:`, err);
    }
  }
  return all;
}
