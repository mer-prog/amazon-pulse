/**
 * Shared helpers for the sync workers: job-run identifiers, sync_logs writers,
 * and a small "wrap a marketplace-scoped sync in try/finally + logSync" frame.
 *
 * Workers report one row per (seller, marketplace) so partial failures are
 * visible — sync_logs.job_run_id ties those rows back to the orchestrator run.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  groupMarketplacesByRegion,
  type SpApiRegion,
} from './sp-api-endpoints.js';

export type SyncJobType = 'orders' | 'inventory' | 'sales_reports' | 'products';
export type SyncStatus = 'started' | 'succeeded' | 'failed' | 'partial';

export interface SyncContext {
  supabase: SupabaseClient;
  jobRunId: string;
}

export interface MarketplaceSyncResult {
  jobRunId: string;
  sellerId: string;
  marketplaceId: string;
  jobType: SyncJobType;
  status: SyncStatus;
  recordsFetched: number;
  recordsUpserted: number;
  startedAt: Date;
  finishedAt: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface MarketplaceSyncCounters {
  fetched: number;
  upserted: number;
}

export function newJobRunId(): string {
  return randomUUID();
}

interface LogSyncRow {
  job_run_id: string;
  seller_id: string;
  marketplace_id: string;
  job_type: SyncJobType;
  status: SyncStatus;
  started_at: string;
  finished_at: string;
  records_fetched: number;
  records_upserted: number;
  error_code: string | null;
  error_message: string | null;
}

export async function writeSyncLog(
  supabase: SupabaseClient,
  result: MarketplaceSyncResult,
): Promise<void> {
  const row: LogSyncRow = {
    job_run_id: result.jobRunId,
    seller_id: result.sellerId,
    marketplace_id: result.marketplaceId,
    job_type: result.jobType,
    status: result.status,
    started_at: result.startedAt.toISOString(),
    finished_at: result.finishedAt.toISOString(),
    records_fetched: result.recordsFetched,
    records_upserted: result.recordsUpserted,
    error_code: result.errorCode ?? null,
    error_message: result.errorMessage ?? null,
  };
  const { error } = await supabase.from('sync_logs').insert(row);
  if (error) {
    // Don't throw — logging failure shouldn't mask the original sync result.
    // eslint-disable-next-line no-console
    console.error(`[sync-logs] insert failed for ${result.jobType}/${result.marketplaceId}:`, error.message);
  }
}

/**
 * Run the marketplace-scoped sync body, capturing fetched/upserted counts and
 * any thrown error. Always returns a MarketplaceSyncResult and always writes a
 * matching row to sync_logs. Throws nothing — partial failures across
 * marketplaces should not abort the orchestrator loop.
 */
export async function runMarketplaceSync(
  ctx: SyncContext,
  meta: { sellerId: string; marketplaceId: string; jobType: SyncJobType },
  body: (counters: MarketplaceSyncCounters) => Promise<void>,
): Promise<MarketplaceSyncResult> {
  const startedAt = new Date();
  const counters: MarketplaceSyncCounters = { fetched: 0, upserted: 0 };
  let status: SyncStatus = 'succeeded';
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  try {
    await body(counters);
  } catch (err) {
    status = 'failed';
    errorCode = (err as { code?: string }).code ?? 'sync_error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }
  const result: MarketplaceSyncResult = {
    jobRunId: ctx.jobRunId,
    sellerId: meta.sellerId,
    marketplaceId: meta.marketplaceId,
    jobType: meta.jobType,
    status,
    recordsFetched: counters.fetched,
    recordsUpserted: counters.upserted,
    startedAt,
    finishedAt: new Date(),
    errorCode,
    errorMessage,
  };
  await writeSyncLog(ctx.supabase, result);
  return result;
}

/**
 * Run a sync `body` against every marketplace in `marketplaceIds`, isolating
 * failures so one marketplace can't abort the rest of the batch.
 *
 * Region awareness: marketplaces are grouped by SP-API region first, then
 * iterated region-by-region. The caller supplies a `clientForRegion` factory
 * which is invoked once per region encountered — letting the factory hand
 * back a region-pinned SpApiClient (so the per-region rate-limit buckets stay
 * separate). The factory result is cached for the duration of the batch.
 *
 * Every result row carries `ctx.jobRunId`, so the entire batch is queryable as
 * one orchestrator run via `sync_logs.job_run_id`.
 *
 * The body is responsible for its own try/catch via `runMarketplaceSync`.
 * If `body` throws synchronously (a programmer bug), the error is captured
 * into a synthetic `failed` MarketplaceSyncResult so the loop continues — the
 * batch contract is "all-or-some, never zero".
 */
export async function runMarketplaceBatch<C>(
  ctx: SyncContext,
  sellerId: string,
  marketplaceIds: readonly string[],
  jobType: SyncJobType,
  clientForRegion: (region: SpApiRegion) => C,
  body: (
    ctx: SyncContext,
    client: C,
    sellerId: string,
    marketplaceId: string,
  ) => Promise<MarketplaceSyncResult>,
): Promise<MarketplaceSyncResult[]> {
  const groups = groupMarketplacesByRegion(marketplaceIds);
  const clientCache = new Map<SpApiRegion, C>();
  const results: MarketplaceSyncResult[] = [];

  for (const [region, ids] of groups) {
    let client = clientCache.get(region);
    if (!client) {
      client = clientForRegion(region);
      clientCache.set(region, client);
    }
    for (const marketplaceId of ids) {
      try {
        results.push(await body(ctx, client, sellerId, marketplaceId));
      } catch (err) {
        // body() should always go through runMarketplaceSync (which never
        // throws). If it did throw, fabricate a failed row so callers still
        // see the batch result and sync_logs is not silently incomplete.
        const now = new Date();
        const failed: MarketplaceSyncResult = {
          jobRunId: ctx.jobRunId,
          sellerId,
          marketplaceId,
          jobType,
          status: 'failed',
          recordsFetched: 0,
          recordsUpserted: 0,
          startedAt: now,
          finishedAt: now,
          errorCode: 'orchestrator_unhandled',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
        await writeSyncLog(ctx.supabase, failed);
        results.push(failed);
      }
    }
  }

  return results;
}
