import { describe, expect, it } from 'vitest';
import {
  listDemoSellers,
  listLatestSyncLogs,
  listSellerMarketplaces,
  loadDashboardSummary,
} from '../../lib/queries';

/**
 * Minimal stub of the @supabase/supabase-js query builder. Only the chain
 * methods our queries.ts actually uses are implemented, so any deviation in
 * production code will fail loudly at the type level (queries are typed
 * against `SupabaseClient`, not this stub — we cast at the boundary).
 */
function makeClient(rows: Record<string, unknown[]>) {
  const calls: Array<{ table: string; op: string; arg?: unknown }> = [];
  function tableQuery(table: string) {
    let result: unknown[] = rows[table] ?? [];
    const builder = {
      select(_cols: string) {
        calls.push({ table, op: 'select' });
        return builder;
      },
      order(_col: string, _opts?: unknown) {
        return builder;
      },
      limit(n: number) {
        result = result.slice(0, n);
        return builder;
      },
      in(col: string, ids: readonly string[]) {
        calls.push({ table, op: 'in', arg: { col, ids } });
        result = result.filter((r) => ids.includes((r as Record<string, string>)[col] ?? ''));
        return builder;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: result, error: null }).then(resolve);
      },
    };
    return builder;
  }
  return {
    client: { from: (table: string) => tableQuery(table) } as never,
    calls,
  };
}

describe('listDemoSellers', () => {
  it('reads from sellers_public and shapes the rows', async () => {
    const { client } = makeClient({
      sellers_public: [
        {
          id: 's1',
          display_name: 'Demo A',
          selling_partner_id: 'SP-A',
          region: 'eu',
          is_active: true,
        },
      ],
    });
    const sellers = await listDemoSellers(client);
    expect(sellers).toEqual([
      { id: 's1', displayName: 'Demo A', sellingPartnerId: 'SP-A', region: 'eu', isActive: true },
    ]);
  });
});

describe('listSellerMarketplaces', () => {
  it('returns empty array without making a query when no seller ids given', async () => {
    const { client, calls } = makeClient({});
    const result = await listSellerMarketplaces(client, []);
    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('filters by seller_id via .in()', async () => {
    const { client, calls } = makeClient({
      seller_marketplaces: [
        { seller_id: 's1', marketplace_id: 'M1', country_code: 'DE', default_currency: 'EUR', is_enabled: true },
        { seller_id: 's2', marketplace_id: 'M2', country_code: 'GB', default_currency: 'GBP', is_enabled: true },
      ],
    });
    const result = await listSellerMarketplaces(client, ['s1']);
    expect(result).toHaveLength(1);
    expect(result[0]?.marketplaceId).toBe('M1');
    expect(calls.some((c) => c.op === 'in')).toBe(true);
  });
});

describe('listLatestSyncLogs', () => {
  it('respects the limit parameter', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`,
      seller_id: 's1',
      marketplace_id: 'M1',
      job_run_id: 'j1',
      job_type: 'orders',
      status: 'succeeded',
      started_at: `2026-05-0${i}`,
      finished_at: null,
      records_fetched: 0,
      records_upserted: 0,
      error_code: null,
      error_message: null,
    }));
    const { client } = makeClient({ sync_logs: rows });
    const result = await listLatestSyncLogs(client, ['s1'], 3);
    expect(result).toHaveLength(3);
  });
});

describe('loadDashboardSummary', () => {
  it('joins sellers with their marketplaces and logs in memory', async () => {
    const { client } = makeClient({
      sellers_public: [
        { id: 's1', display_name: 'A', selling_partner_id: 'SP-A', region: 'eu', is_active: true },
        { id: 's2', display_name: 'B', selling_partner_id: 'SP-B', region: 'eu', is_active: true },
      ],
      seller_marketplaces: [
        { seller_id: 's1', marketplace_id: 'M1', country_code: 'DE', default_currency: 'EUR', is_enabled: true },
        { seller_id: 's2', marketplace_id: 'M2', country_code: 'GB', default_currency: 'GBP', is_enabled: true },
      ],
      sync_logs: [
        {
          id: 'l1', seller_id: 's1', marketplace_id: 'M1', job_run_id: 'j1',
          job_type: 'orders', status: 'succeeded',
          started_at: '2026-05-09T10:00:00Z', finished_at: '2026-05-09T10:00:05Z',
          records_fetched: 2, records_upserted: 2, error_code: null, error_message: null,
        },
      ],
    });
    const summaries = await loadDashboardSummary(client);
    expect(summaries).toHaveLength(2);
    const a = summaries.find((s) => s.seller.id === 's1');
    expect(a?.marketplaces[0]?.marketplaceId).toBe('M1');
    expect(a?.latestLogs[0]?.recordsUpserted).toBe(2);
    const b = summaries.find((s) => s.seller.id === 's2');
    expect(b?.latestLogs).toEqual([]);
  });
});
