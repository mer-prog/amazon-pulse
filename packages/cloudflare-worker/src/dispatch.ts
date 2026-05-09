/**
 * Map a Cloudflare cron pattern (the literal string from wrangler.toml) to
 * the pipeline job(s) it should run. Centralised here so the routing is unit
 * testable in isolation and stays in sync with wrangler.toml.
 *
 * If you change the cron expressions in wrangler.toml, update this table.
 */

export type CronJob = 'orders' | 'inventory' | 'sales_reports' | 'products';

export const CRON_TO_JOBS: Readonly<Record<string, readonly CronJob[]>> = {
  // Every 6 hours, on the hour — orders
  '0 */6 * * *':  ['orders'],
  // Every 6 hours, offset +15 minutes — inventory (separate trigger so the
  // two heavy SP-API jobs don't compete for rate-limit budget at t=0).
  '15 */6 * * *': ['inventory'],
  // Daily 00:00 UTC — sales_reports
  '0 0 * * *':    ['sales_reports'],
  // Weekly, Sundays 00:00 UTC — products catalog refresh
  '0 0 * * 0':    ['products'],
};

export function jobsForCron(cron: string): readonly CronJob[] {
  return CRON_TO_JOBS[cron] ?? [];
}
