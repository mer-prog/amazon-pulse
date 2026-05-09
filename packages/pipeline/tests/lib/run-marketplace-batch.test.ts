import { describe, it, expect } from 'vitest';
import { FakeSupabase } from '../workers/_mocks.js';
import {
  newJobRunId,
  runMarketplaceBatch,
  runMarketplaceSync,
  type MarketplaceSyncResult,
  type SyncContext,
} from '../../src/lib/sync-helpers.js';
import { EU_MARKETPLACES, type SpApiRegion } from '../../src/lib/sp-api-endpoints.js';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';

interface FakeRegionClient {
  region: SpApiRegion;
  tag: string;
}

function buildCtx(): { supabase: FakeSupabase; ctx: SyncContext } {
  const supabase = new FakeSupabase();
  const ctx: SyncContext = {
    supabase: supabase.asSupabaseClient(),
    jobRunId: newJobRunId(),
  };
  return { supabase, ctx };
}

describe('runMarketplaceBatch', () => {
  it('runs body once per marketplace and binds every result to the same job_run_id', async () => {
    const { supabase, ctx } = buildCtx();
    const visited: string[] = [];

    const factoryCalls: SpApiRegion[] = [];
    const clientForRegion = (region: SpApiRegion): FakeRegionClient => {
      factoryCalls.push(region);
      return { region, tag: `client:${region}` };
    };

    const results = await runMarketplaceBatch(
      ctx,
      SELLER_ID,
      [EU_MARKETPLACES.UK, EU_MARKETPLACES.DE, EU_MARKETPLACES.FR],
      'orders',
      clientForRegion,
      async (innerCtx, client, sellerId, marketplaceId) => {
        visited.push(`${client.tag}/${marketplaceId}`);
        return runMarketplaceSync(
          innerCtx,
          { sellerId, marketplaceId, jobType: 'orders' },
          async (counters) => {
            counters.fetched = 1;
            counters.upserted = 1;
          },
        );
      },
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.jobRunId === ctx.jobRunId)).toBe(true);
    expect(results.every((r) => r.status === 'succeeded')).toBe(true);
    expect(visited).toEqual([
      `client:eu/${EU_MARKETPLACES.UK}`,
      `client:eu/${EU_MARKETPLACES.DE}`,
      `client:eu/${EU_MARKETPLACES.FR}`,
    ]);
    // All three EU marketplaces share one region → factory called exactly once.
    expect(factoryCalls).toEqual(['eu']);

    const logs = supabase.table('sync_logs').rows;
    expect(logs).toHaveLength(3);
    expect(new Set(logs.map((l) => l['marketplace_id']))).toEqual(
      new Set([EU_MARKETPLACES.UK, EU_MARKETPLACES.DE, EU_MARKETPLACES.FR]),
    );
    expect(logs.every((l) => l['job_run_id'] === ctx.jobRunId)).toBe(true);
  });

  it('isolates partial failures: one failed marketplace does not abort the rest', async () => {
    const { supabase, ctx } = buildCtx();
    const clientForRegion = (region: SpApiRegion): FakeRegionClient => ({
      region,
      tag: `client:${region}`,
    });

    const results = await runMarketplaceBatch(
      ctx,
      SELLER_ID,
      [EU_MARKETPLACES.UK, EU_MARKETPLACES.DE, EU_MARKETPLACES.FR],
      'orders',
      clientForRegion,
      async (innerCtx, _client, sellerId, marketplaceId) =>
        runMarketplaceSync(
          innerCtx,
          { sellerId, marketplaceId, jobType: 'orders' },
          async (counters) => {
            if (marketplaceId === EU_MARKETPLACES.DE) {
              throw new Error('SP-API 503 from DE');
            }
            counters.fetched = 1;
            counters.upserted = 1;
          },
        ),
    );

    expect(results).toHaveLength(3);
    const byMp = new Map<string, MarketplaceSyncResult>(
      results.map((r) => [r.marketplaceId, r]),
    );
    expect(byMp.get(EU_MARKETPLACES.UK)?.status).toBe('succeeded');
    expect(byMp.get(EU_MARKETPLACES.DE)?.status).toBe('failed');
    expect(byMp.get(EU_MARKETPLACES.DE)?.errorMessage).toContain('503');
    expect(byMp.get(EU_MARKETPLACES.FR)?.status).toBe('succeeded');

    // sync_logs reflects the same fan-out, all rows tagged with the same run.
    const logs = supabase.table('sync_logs').rows;
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l['job_run_id'] === ctx.jobRunId)).toBe(true);
    expect(logs.find((l) => l['marketplace_id'] === EU_MARKETPLACES.DE)?.['status']).toBe(
      'failed',
    );
  });

  it('captures synchronous body throws into a synthetic failed row so the loop continues', async () => {
    const { supabase, ctx } = buildCtx();
    const clientForRegion = (region: SpApiRegion): FakeRegionClient => ({
      region,
      tag: `client:${region}`,
    });

    const results = await runMarketplaceBatch(
      ctx,
      SELLER_ID,
      [EU_MARKETPLACES.UK, EU_MARKETPLACES.DE],
      'orders',
      clientForRegion,
      // Body bypasses runMarketplaceSync, so a throw here would normally abort
      // the batch. The orchestrator must catch it and continue.
      async (_ctx, _client, _sellerId, marketplaceId) => {
        if (marketplaceId === EU_MARKETPLACES.UK) {
          throw new Error('programmer bug');
        }
        return {
          jobRunId: ctx.jobRunId,
          sellerId: SELLER_ID,
          marketplaceId,
          jobType: 'orders',
          status: 'succeeded',
          recordsFetched: 0,
          recordsUpserted: 0,
          startedAt: new Date(),
          finishedAt: new Date(),
        };
      },
    );

    expect(results).toHaveLength(2);
    const ukResult = results.find((r) => r.marketplaceId === EU_MARKETPLACES.UK)!;
    expect(ukResult.status).toBe('failed');
    expect(ukResult.errorCode).toBe('orchestrator_unhandled');
    expect(ukResult.errorMessage).toContain('programmer bug');

    // The fabricated failure also reaches sync_logs (one row from the body's
    // own success path + one synthetic row written by the orchestrator).
    const logs = supabase.table('sync_logs').rows;
    expect(logs).toHaveLength(1);
    // Note: the success branch above does not call runMarketplaceSync (so it
    // doesn't write its own log) — only the synthetic failure row lands here.
    expect(logs[0]?.['marketplace_id']).toBe(EU_MARKETPLACES.UK);
    expect(logs[0]?.['status']).toBe('failed');
  });
});
