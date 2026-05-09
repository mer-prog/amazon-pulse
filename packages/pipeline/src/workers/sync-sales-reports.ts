/**
 * Sales reports sync worker.
 *
 * SP-API report flow (2021-06-30):
 *   1. POST   /reports/2021-06-30/reports          ← request the report
 *   2. GET    /reports/2021-06-30/reports/{id}     ← poll until DONE / FATAL
 *   3. GET    /reports/2021-06-30/documents/{id}   ← presigned URL + compression
 *   4. GET    <presigned url>                      ← actual JSON body
 *
 * We request GET_SALES_AND_TRAFFIC_REPORT and parse the salesAndTrafficByAsin
 * array — that gives us per-day, per-ASIN units / revenue / sessions which
 * maps cleanly onto sales_reports (whose unique key is now ASIN-based).
 *
 * Idempotency: UNIQUE (seller_id, marketplace_id, report_date, asin) +
 * Supabase upsert.
 */

import { gunzipSync } from 'node:zlib';
import type { SpApiClient } from '../lib/sp-api-client.js';
import {
  runMarketplaceSync,
  type MarketplaceSyncResult,
  type SyncContext,
} from '../lib/sync-helpers.js';
import {
  REPORT_TERMINAL_STATUSES,
  SalesAndTrafficReportSchema,
  type ReportProcessingStatus,
  type SalesAndTrafficReport,
} from '../schemas/reports.js';

export interface SalesReportsSyncContext extends SyncContext {
  client: SpApiClient;
}

export interface SalesReportsSyncOptions {
  /** ISO-8601 (date, not datetime) — start of the reporting window. */
  dataStartTime: string;
  /** ISO-8601 — end of the reporting window. Defaults to startTime + 1 day. */
  dataEndTime?: string;
  /** Polling interval in ms. Defaults to 5_000. */
  pollIntervalMs?: number;
  /** Max polling attempts before giving up. Defaults to 60 (≈5 minutes). */
  maxPollAttempts?: number;
  /** Override the SP-API report type (mostly for tests). */
  reportType?: string;
}

const SALES_REPORTS_CONFLICT_TARGET = 'seller_id,marketplace_id,report_date,asin';
const DEFAULT_REPORT_TYPE = 'GET_SALES_AND_TRAFFIC_REPORT';

interface SalesReportRow {
  seller_id: string;
  marketplace_id: string;
  report_date: string;
  sku: string | null;
  asin: string;
  units_ordered: number;
  units_refunded: number;
  ordered_product_sales_amount: number;
  ordered_product_sales_currency: string | null;
  sessions: number | null;
  page_views: number | null;
  buy_box_percentage: number | null;
  raw: unknown;
  updated_at: string | null;
  synced_at: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function deriveReportDate(report: SalesAndTrafficReport, fallback: string): string {
  const ts = report.reportSpecification?.dataStartTime ?? fallback;
  // Strip time portion if present — sales_reports.report_date is a DATE column.
  return ts.slice(0, 10);
}

function toSalesReportRows(
  parsed: SalesAndTrafficReport,
  sellerId: string,
  marketplaceId: string,
  fallbackDate: string,
  syncedAt: string,
): SalesReportRow[] {
  const reportDate = deriveReportDate(parsed, fallbackDate);
  const rows: SalesReportRow[] = [];
  for (const row of parsed.salesAndTrafficByAsin ?? []) {
    rows.push({
      seller_id: sellerId,
      marketplace_id: marketplaceId,
      report_date: reportDate,
      sku: row.sku ?? null,
      asin: row.childAsin,
      units_ordered: row.salesByAsin?.unitsOrdered ?? 0,
      units_refunded: 0,
      ordered_product_sales_amount: row.salesByAsin?.orderedProductSales?.amount ?? 0,
      ordered_product_sales_currency: row.salesByAsin?.orderedProductSales?.currencyCode ?? null,
      sessions: row.trafficByAsin?.sessions ?? null,
      page_views: row.trafficByAsin?.pageViews ?? null,
      buy_box_percentage: row.trafficByAsin?.buyBoxPercentage ?? null,
      raw: row,
      updated_at: null,
      synced_at: syncedAt,
    });
  }
  return rows;
}

export async function syncSalesReportsForMarketplace(
  ctx: SalesReportsSyncContext,
  sellerId: string,
  marketplaceId: string,
  opts: SalesReportsSyncOptions,
): Promise<MarketplaceSyncResult> {
  return runMarketplaceSync(
    ctx,
    { sellerId, marketplaceId, jobType: 'sales_reports' },
    async (counters) => {
      const reportType = opts.reportType ?? DEFAULT_REPORT_TYPE;
      const dataEndTime = opts.dataEndTime ?? addDaysIso(opts.dataStartTime, 1);

      const { reportId } = await ctx.client.createReport({
        reportType,
        marketplaceIds: [marketplaceId],
        dataStartTime: opts.dataStartTime,
        dataEndTime,
      });

      const finalReport = await pollUntilTerminal(ctx.client, reportId, opts);
      if (finalReport.processingStatus !== 'DONE') {
        throw new Error(
          `report ${reportId} ended in non-terminal status ${finalReport.processingStatus}`,
        );
      }
      const documentId = finalReport.reportDocumentId;
      if (!documentId) {
        throw new Error(`report ${reportId} has no reportDocumentId`);
      }

      const doc = await ctx.client.getReportDocument(documentId);
      const rawBody = await ctx.client.downloadReportDocumentText(doc.url);
      const decoded = doc.compressionAlgorithm === 'GZIP' ? gunzipDecode(rawBody) : rawBody;
      const parsed = SalesAndTrafficReportSchema.parse(JSON.parse(decoded));

      const syncedAt = new Date().toISOString();
      const rows = toSalesReportRows(
        parsed,
        sellerId,
        marketplaceId,
        opts.dataStartTime,
        syncedAt,
      );
      counters.fetched += rows.length;
      if (rows.length > 0) {
        const { error } = await ctx.supabase
          .from('sales_reports')
          .upsert(rows, { onConflict: SALES_REPORTS_CONFLICT_TARGET });
        if (error) throw new Error(`sales_reports upsert failed: ${error.message}`);
        counters.upserted += rows.length;
      }
    },
  );
}

export async function syncSalesReportsForSeller(
  ctx: SalesReportsSyncContext,
  sellerId: string,
  marketplaceIds: string[],
  opts: SalesReportsSyncOptions,
): Promise<MarketplaceSyncResult[]> {
  const results: MarketplaceSyncResult[] = [];
  for (const m of marketplaceIds) {
    results.push(await syncSalesReportsForMarketplace(ctx, sellerId, m, opts));
  }
  return results;
}

async function pollUntilTerminal(
  client: SpApiClient,
  reportId: string,
  opts: SalesReportsSyncOptions,
): Promise<{ processingStatus: ReportProcessingStatus; reportDocumentId?: string }> {
  const intervalMs = opts.pollIntervalMs ?? 5_000;
  const maxAttempts = opts.maxPollAttempts ?? 60;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const r = await client.getReport(reportId);
    const status = r.processingStatus as ReportProcessingStatus;
    if ((REPORT_TERMINAL_STATUSES as readonly string[]).includes(status)) {
      return { processingStatus: status, reportDocumentId: r.reportDocumentId };
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `report ${reportId} did not reach a terminal status within ${maxAttempts} polls`,
  );
}

function gunzipDecode(text: string): string {
  // The presigned S3 url is fetched as text; for GZIP we need the raw bytes.
  // axios with responseType:'text' coerces via latin1 in Node so the byte
  // sequence is preserved. Convert back via Buffer.from(text, 'binary').
  const buf = Buffer.from(text, 'binary');
  return gunzipSync(buf).toString('utf8');
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
