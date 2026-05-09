/**
 * Shared helpers for the sync workers: job-run identifiers, sync_logs writers,
 * and a small "wrap a marketplace-scoped sync in try/finally + logSync" frame.
 *
 * Workers report one row per (seller, marketplace) so partial failures are
 * visible — sync_logs.job_run_id ties those rows back to the orchestrator run.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

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
