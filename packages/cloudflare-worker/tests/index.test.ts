import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the per-job handlers so dispatchCron's routing + isolation can be
// exercised without touching Supabase or the SP-API client.
const calls: string[] = [];
vi.mock('../src/handlers/orders.js', () => ({
  runOrdersCron: vi.fn(async () => {
    calls.push('orders');
  }),
}));
vi.mock('../src/handlers/inventory.js', () => ({
  runInventoryCron: vi.fn(async () => {
    calls.push('inventory');
  }),
}));
vi.mock('../src/handlers/sales-reports.js', () => ({
  runSalesReportsCron: vi.fn(async () => {
    calls.push('sales_reports');
  }),
}));
vi.mock('../src/handlers/products.js', () => ({
  runProductsCron: vi.fn(async () => {
    calls.push('products');
  }),
}));

import { dispatchCron } from '../src/index.js';
import type { CronEnv } from '../src/env.js';

const ENV: CronEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  SP_API_CLIENT_ID: 'cid',
  SP_API_CLIENT_SECRET: 'csecret',
  ENCRYPTION_KEY: 'a'.repeat(44),
};

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dispatchCron', () => {
  it('routes the orders cron to the orders handler', async () => {
    const jobs = await dispatchCron('0 */6 * * *', { ...ENV });
    expect(jobs).toEqual(['orders']);
    expect(calls).toEqual(['orders']);
  });

  it('routes the inventory cron', async () => {
    await dispatchCron('15 */6 * * *', { ...ENV });
    expect(calls).toEqual(['inventory']);
  });

  it('routes the daily sales-reports cron', async () => {
    await dispatchCron('0 0 * * *', { ...ENV });
    expect(calls).toEqual(['sales_reports']);
  });

  it('routes the weekly products cron', async () => {
    await dispatchCron('0 0 * * 0', { ...ENV });
    expect(calls).toEqual(['products']);
  });

  it('returns [] and does NOT throw for an unknown cron', async () => {
    const jobs = await dispatchCron('not-a-cron', { ...ENV });
    expect(jobs).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('rejects when required env vars are missing', async () => {
    const partial = { ...ENV };
    partial.SUPABASE_URL = '';
    await expect(dispatchCron('0 */6 * * *', partial)).rejects.toThrow(/SUPABASE_URL/);
  });

  it('logs and swallows handler errors so subsequent invocations still run', async () => {
    const ordersMod = await import('../src/handlers/orders.js');
    const invMod = await import('../src/handlers/inventory.js');
    const ordersFn = ordersMod.runOrdersCron as unknown as ReturnType<typeof vi.fn>;
    const inventoryFn = invMod.runInventoryCron as unknown as ReturnType<typeof vi.fn>;
    ordersFn.mockRejectedValueOnce(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Orders cron — handler throws but dispatchCron still resolves cleanly.
    await expect(dispatchCron('0 */6 * * *', { ...ENV })).resolves.toEqual(['orders']);
    expect(errSpy).toHaveBeenCalledTimes(1);

    // Subsequent inventory cron continues to fire normally.
    await dispatchCron('15 */6 * * *', { ...ENV });
    expect(inventoryFn).toHaveBeenCalledTimes(1);
  });
});
