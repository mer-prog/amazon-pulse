import { z } from 'zod';

/**
 * SP-API Reports 2021-06-30. We use the create / poll / fetch-document flow:
 *   POST   /reports/2021-06-30/reports               → reportId
 *   GET    /reports/2021-06-30/reports/{reportId}    → status, reportDocumentId
 *   GET    /reports/2021-06-30/documents/{docId}     → presigned S3 url
 *
 * Reference:
 *   https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json
 */

export const CreateReportResponseSchema = z
  .object({ reportId: z.string() })
  .passthrough();
export type CreateReportResponse = z.infer<typeof CreateReportResponseSchema>;

export const REPORT_TERMINAL_STATUSES = ['DONE', 'CANCELLED', 'FATAL'] as const;
export type ReportProcessingStatus =
  | 'IN_QUEUE'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'CANCELLED'
  | 'FATAL';

export const ReportSchema = z
  .object({
    reportId: z.string(),
    reportType: z.string(),
    processingStatus: z.string(),
    dataStartTime: z.string().optional(),
    dataEndTime: z.string().optional(),
    marketplaceIds: z.array(z.string()).optional(),
    reportDocumentId: z.string().optional(),
    createdTime: z.string().optional(),
    processingStartTime: z.string().optional(),
    processingEndTime: z.string().optional(),
  })
  .passthrough();
export type Report = z.infer<typeof ReportSchema>;

const CompressionSchema = z.union([z.literal('GZIP'), z.string()]).optional();

export const ReportDocumentSchema = z
  .object({
    reportDocumentId: z.string(),
    url: z.string().url(),
    compressionAlgorithm: CompressionSchema,
  })
  .passthrough();
export type ReportDocument = z.infer<typeof ReportDocumentSchema>;

// ── GET_SALES_AND_TRAFFIC_REPORT body (JSON, served from the document URL) ──

export const SalesByAsinSchema = z
  .object({
    orderedProductSales: z
      .object({ amount: z.number(), currencyCode: z.string().length(3) })
      .passthrough()
      .optional(),
    unitsOrdered: z.number().int().nonnegative().optional(),
    totalOrderItems: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const TrafficByAsinSchema = z
  .object({
    sessions: z.number().int().nonnegative().optional(),
    pageViews: z.number().int().nonnegative().optional(),
    buyBoxPercentage: z.number().nonnegative().optional(),
  })
  .passthrough();

export const SalesAndTrafficByAsinRowSchema = z
  .object({
    parentAsin: z.string().optional(),
    childAsin: z.string(),
    sku: z.string().optional(),
    salesByAsin: SalesByAsinSchema.optional(),
    trafficByAsin: TrafficByAsinSchema.optional(),
  })
  .passthrough();
export type SalesAndTrafficByAsinRow = z.infer<typeof SalesAndTrafficByAsinRowSchema>;

export const SalesAndTrafficReportSchema = z
  .object({
    reportSpecification: z.object({ dataStartTime: z.string().optional() }).passthrough().optional(),
    salesAndTrafficByAsin: z.array(SalesAndTrafficByAsinRowSchema).optional(),
  })
  .passthrough();
export type SalesAndTrafficReport = z.infer<typeof SalesAndTrafficReportSchema>;
