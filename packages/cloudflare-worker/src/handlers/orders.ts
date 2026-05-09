import {
  newJobRunId,
  runMarketplaceBatch,
  syncOrdersForMarketplace,
  type MarketplaceSyncResult,
  type SpApiRegion,
  type SpApiClient,
} from '@amazon-pulse/pipeline';
import {
  buildClientFactory,
  getSupabase,
  isoSinceMinutes,
  loadActiveSellers,
} from './shared.js';
import type { CronEnv } from '../env.js';

/**
 * Cron: every 6 hours. Pull orders updated in the last ~7 hours (slightly
 * wider than the cadence so updates that land mid-cron are captured on the
 * next pass).
 */
export async function runOrdersCron(env: CronEnv): Promise<MarketplaceSyncResult[]> {
  const supabase = getSupabase();
  const sellers = await loadActiveSellers(supabase);
  if (sellers.length === 0) return [];

  const createdAfter = isoSinceMinutes(7 * 60);
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
        'orders',
        (region: SpApiRegion) => clientFactory(region),
        (c, client, sellerId, marketplaceId) =>
          syncOrdersForMarketplace(
            { ...c, client },
            sellerId,
            marketplaceId,
            { createdAfter },
          ),
      );
      all.push(...results);
    } catch (err) {
      // A failure to even build the client (e.g. decrypt error) would block
      // this seller; capture and continue with the rest.
      // eslint-disable-next-line no-console
      console.error(`[cron:orders] seller ${s.sellerId} aborted:`, err);
    }
  }
  return all;
}
