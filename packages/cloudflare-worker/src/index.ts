/**
 * Cloudflare Workers entry point for the amazon-pulse cron pipeline.
 *
 * One Worker, four cron triggers (see wrangler.toml). The runtime delivers a
 * `ScheduledEvent` carrying the cron string that fired; we route on that
 * string via `dispatch.ts` and run the matching pipeline job.
 *
 * The pipeline package is a Node-flavoured library that reads `process.env`
 * for credentials. With the `nodejs_compat` flag enabled (wrangler.toml),
 * `process` is available on Workers, but `process.env` starts empty — we
 * mirror the env binding into it on every invocation.
 */

import type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types';
import { assertEnv, populateProcessEnv, type CronEnv } from './env.js';
import { jobsForCron, type CronJob } from './dispatch.js';
import { runOrdersCron } from './handlers/orders.js';
import { runInventoryCron } from './handlers/inventory.js';
import { runSalesReportsCron } from './handlers/sales-reports.js';
import { runProductsCron } from './handlers/products.js';

const HANDLERS: Readonly<Record<CronJob, (env: CronEnv) => Promise<unknown>>> = {
  orders:        runOrdersCron,
  inventory:     runInventoryCron,
  sales_reports: runSalesReportsCron,
  products:      runProductsCron,
};

export async function dispatchCron(cron: string, env: CronEnv): Promise<CronJob[]> {
  assertEnv(env);
  populateProcessEnv(env);
  const jobs = jobsForCron(cron);
  if (jobs.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[cron] no handler registered for "${cron}"`);
    return [];
  }
  for (const job of jobs) {
    const handler = HANDLERS[job];
    try {
      await handler(env);
    } catch (err) {
      // Per-job isolation — one job failing shouldn't abort the rest of the
      // batch. Errors at this layer are *programmer bugs* (the per-seller
      // handlers already catch and log everything they can).
      // eslint-disable-next-line no-console
      console.error(`[cron] job "${job}" for cron "${cron}" failed:`, err);
    }
  }
  return [...jobs];
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: CronEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(dispatchCron(controller.cron, env));
  },
};
