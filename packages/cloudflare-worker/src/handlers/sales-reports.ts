import {
  newJobRunId,
  runMarketplaceBatch,
  syncSalesReportsForMarketplace,
  type MarketplaceSyncResult,
  type SpApiRegion,
  type SpApiClient,
} from '@amazon-pulse/pipeline';
import {
  buildClientFactory,
  getSupabase,
  isoDate,
  loadActiveSellers,
} from './shared.js';
import type { CronEnv } from '../env.js';

/**
 * Cron: daily at 00:00 UTC. Pulls yesterday's sales-and-traffic report.
 * The reporting window aligns to a UTC calendar day to match how Amazon
 * aggregates the `GET_SALES_AND_TRAFFIC_REPORT` rows.
 */
export async function runSalesReportsCron(env: CronEnv): Promise<MarketplaceSyncResult[]> {
  const supabase = getSupabase();
  const sellers = await loadActiveSellers(supabase);
  if (sellers.length === 0) return [];

  const dataStartTime = isoDate(1);
  const dataEndTime   = isoDate(0);

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
        'sales_reports',
        (region: SpApiRegion) => clientFactory(region),
        (c, client, sellerId, marketplaceId) =>
          syncSalesReportsForMarketplace(
            { ...c, client },
            sellerId,
            marketplaceId,
            { dataStartTime, dataEndTime },
          ),
      );
      all.push(...results);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cron:sales_reports] seller ${s.sellerId} aborted:`, err);
    }
  }
  return all;
}
