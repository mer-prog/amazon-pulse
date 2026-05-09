import {
  newJobRunId,
  runMarketplaceBatch,
  syncInventoryForMarketplace,
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
 * Cron: every 6 hours, offset +15 minutes. FBA inventory does not need a
 * time window — the API returns the current snapshot.
 */
export async function runInventoryCron(env: CronEnv): Promise<MarketplaceSyncResult[]> {
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
        'inventory',
        (region: SpApiRegion) => clientFactory(region),
        (c, client, sellerId, marketplaceId) =>
          syncInventoryForMarketplace({ ...c, client }, sellerId, marketplaceId),
      );
      all.push(...results);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cron:inventory] seller ${s.sellerId} aborted:`, err);
    }
  }
  return all;
}
