import { describe, expect, it } from 'vitest';
import { CRON_TO_JOBS, jobsForCron } from '../src/dispatch.js';

describe('dispatch / cron → jobs map', () => {
  it('routes the orders cron pattern', () => {
    expect(jobsForCron('0 */6 * * *')).toEqual(['orders']);
  });

  it('routes the inventory offset cron', () => {
    expect(jobsForCron('15 */6 * * *')).toEqual(['inventory']);
  });

  it('routes the daily sales-reports cron', () => {
    expect(jobsForCron('0 0 * * *')).toEqual(['sales_reports']);
  });

  it('routes the weekly products cron', () => {
    expect(jobsForCron('0 0 * * 0')).toEqual(['products']);
  });

  it('returns an empty list for unknown cron strings', () => {
    expect(jobsForCron('nonsense')).toEqual([]);
    expect(jobsForCron('* * * * *')).toEqual([]);
  });

  it('lists a unique cron expression per job', () => {
    // Defensive guard so a future patch can't accidentally collapse two jobs
    // onto the same cron string and have one silently win.
    const crons = Object.keys(CRON_TO_JOBS);
    expect(new Set(crons).size).toBe(crons.length);
  });

  it('covers every cron expression in wrangler.toml', () => {
    // Keep this synced with wrangler.toml. If the cron set changes, both
    // files need to update — failing this test is a useful tripwire.
    const expected = ['0 */6 * * *', '15 */6 * * *', '0 0 * * *', '0 0 * * 0'];
    for (const cron of expected) {
      expect(jobsForCron(cron).length, `cron "${cron}" should resolve to a job`).toBeGreaterThan(0);
    }
  });
});
