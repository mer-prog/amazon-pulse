import { describe, it, expect, vi } from 'vitest';
import { FakeSupabase } from './_mocks.js';
import { syncSalesReportsForMarketplace } from '../../src/workers/sync-sales-reports.js';
import { newJobRunId } from '../../src/lib/sync-helpers.js';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';
const MARKETPLACE_ID = 'A1PA6795UKMFR9';

function buildContext() {
  const supabase = new FakeSupabase();
  const client = {
    createReport: vi.fn(),
    getReport: vi.fn(),
    getReportDocument: vi.fn(),
    downloadReportDocumentText: vi.fn(),
  };
  const ctx = {
    supabase: supabase.asSupabaseClient(),
    client: client as unknown as import('../../src/lib/sp-api-client.js').SpApiClient,
    jobRunId: newJobRunId(),
  };
  return { supabase, client, ctx };
}

const REPORT_BODY = JSON.stringify({
  reportSpecification: { dataStartTime: '2026-05-08T00:00:00Z' },
  salesAndTrafficByAsin: [
    {
      childAsin: 'B0FAKE00001',
      sku: 'DEMO-SKU-DE-001',
      salesByAsin: {
        orderedProductSales: { amount: 49.99, currencyCode: 'EUR' },
        unitsOrdered: 1,
      },
      trafficByAsin: { sessions: 42, pageViews: 58, buyBoxPercentage: 89.1 },
    },
    {
      childAsin: 'B0FAKE00002',
      salesByAsin: {
        orderedProductSales: { amount: 24.99, currencyCode: 'EUR' },
        unitsOrdered: 1,
      },
      trafficByAsin: { sessions: 31, pageViews: 44 },
    },
  ],
});

describe('syncSalesReportsForMarketplace', () => {
  it('runs the create→poll→fetch flow and upserts ASIN-level rows', async () => {
    const { supabase, client, ctx } = buildContext();
    client.createReport.mockResolvedValueOnce({ reportId: 'R-1' });
    client.getReport
      .mockResolvedValueOnce({
        reportId: 'R-1',
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
        processingStatus: 'IN_PROGRESS',
      })
      .mockResolvedValueOnce({
        reportId: 'R-1',
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
        processingStatus: 'DONE',
        reportDocumentId: 'D-1',
      });
    client.getReportDocument.mockResolvedValueOnce({
      reportDocumentId: 'D-1',
      url: 'https://example.com/report.json',
    });
    client.downloadReportDocumentText.mockResolvedValueOnce(REPORT_BODY);

    const result = await syncSalesReportsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      dataStartTime: '2026-05-08T00:00:00Z',
      pollIntervalMs: 1,
    });

    expect(result.status).toBe('succeeded');
    expect(result.recordsFetched).toBe(2);
    expect(supabase.table('sales_reports').rows).toHaveLength(2);
    const stored = supabase.table('sales_reports').rows.map((r) => r['asin']).sort();
    expect(stored).toEqual(['B0FAKE00001', 'B0FAKE00002']);
    expect(client.getReport).toHaveBeenCalledTimes(2);
  });

  it('is idempotent across runs (same report twice → same row count)', async () => {
    const { supabase, client, ctx } = buildContext();

    const setupOneRun = (): void => {
      client.createReport.mockResolvedValueOnce({ reportId: 'R-2' });
      client.getReport.mockResolvedValueOnce({
        reportId: 'R-2',
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
        processingStatus: 'DONE',
        reportDocumentId: 'D-2',
      });
      client.getReportDocument.mockResolvedValueOnce({
        reportDocumentId: 'D-2',
        url: 'https://example.com/r.json',
      });
      client.downloadReportDocumentText.mockResolvedValueOnce(REPORT_BODY);
    };

    setupOneRun();
    await syncSalesReportsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      dataStartTime: '2026-05-08T00:00:00Z',
      pollIntervalMs: 1,
    });
    setupOneRun();
    await syncSalesReportsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      dataStartTime: '2026-05-08T00:00:00Z',
      pollIntervalMs: 1,
    });

    expect(supabase.table('sales_reports').rows).toHaveLength(2);
  });

  it('logs failure when the report ends in FATAL', async () => {
    const { supabase, client, ctx } = buildContext();
    client.createReport.mockResolvedValueOnce({ reportId: 'R-FAIL' });
    client.getReport.mockResolvedValueOnce({
      reportId: 'R-FAIL',
      reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
      processingStatus: 'FATAL',
    });
    const result = await syncSalesReportsForMarketplace(ctx, SELLER_ID, MARKETPLACE_ID, {
      dataStartTime: '2026-05-08T00:00:00Z',
      pollIntervalMs: 1,
    });
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('FATAL');
    expect(supabase.table('sales_reports').rows).toHaveLength(0);
    expect(supabase.table('sync_logs').rows[0]!['status']).toBe('failed');
  });
});
