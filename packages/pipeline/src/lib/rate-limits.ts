/**
 * SP-API per-operation rate limits.
 *
 * These are the *default* usage-plan rate / burst values published by Amazon
 * for sandbox and new production accounts. Selling partners with higher
 * throughput agreements can be granted larger values; production traffic
 * should rely on the `x-amzn-RateLimit-Limit` response header to tune the
 * runtime values (Phase 3c — not yet implemented).
 *
 * Sources (last verified 2026-05):
 *   - Usage Plans and Rate Limits — overview / token bucket model:
 *       https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits
 *   - Orders API rate limits page (per-operation table):
 *       https://developer-docs.amazon.com/sp-api/docs/orders-api-rate-limits
 *       getOrders:                rate 0.0167 rps, burst 20
 *       getOrderItems:            rate 0.5    rps, burst 30
 *   - FBA Inventory v1 — getInventorySummaries reference page:
 *       https://developer-docs.amazon.com/sp-api/reference/getinventorysummaries
 *       getInventorySummaries:    rate 2      rps, burst 2
 *   - Catalog Items 2022-04-01 — searchCatalogItems reference page
 *     (and SP-API throttling adjustments changelog confirming the 5/5 → 2/2
 *     reduction):
 *       https://developer-docs.amazon.com/sp-api/reference/searchcatalogitems
 *       https://developer-docs.amazon.com/sp-api/changelog/sp-api-throttling-adjustments
 *       searchCatalogItems:       rate 2      rps, burst 2
 *   - Reports API 2021-06-30 reference pages:
 *       https://developer-docs.amazon.com/sp-api/reference/createreport
 *       https://developer-docs.amazon.com/sp-api/reference/getreport
 *       https://developer-docs.amazon.com/sp-api/reference/getreportdocument
 *       createReport:             rate 0.0167 rps, burst 15
 *       getReport:                rate 2      rps, burst 15
 *       getReportDocument:        rate 0.0167 rps, burst 15
 *
 * `rate` is the steady-state refill rate in tokens per second. `burst` is the
 * maximum bucket capacity (and the initial fill).
 */

export interface RateLimitSpec {
  /** Steady-state refill rate, in tokens (≈ requests) per second. */
  readonly rate: number;
  /** Maximum bucket capacity, in tokens. Bucket starts full at this value. */
  readonly burst: number;
}

export const SP_API_RATE_LIMITS = {
  getOrders: { rate: 0.0167, burst: 20 },
  getOrderItems: { rate: 0.5, burst: 30 },
  getInventorySummaries: { rate: 2, burst: 2 },
  searchCatalogItems: { rate: 2, burst: 2 },
  createReport: { rate: 0.0167, burst: 15 },
  getReport: { rate: 2, burst: 15 },
  getReportDocument: { rate: 0.0167, burst: 15 },
} as const satisfies Record<string, RateLimitSpec>;

export type SpApiOperation = keyof typeof SP_API_RATE_LIMITS;

/**
 * Build the bucket key for a given operation. Today this is just the operation
 * name — SP-API rate limits are scoped per operation per selling-partner
 * application, and we run a single application across regions.
 *
 * Multi-region note: if we ever fan out to multiple SP-API regions in
 * parallel, the limits are tracked independently per region by Amazon, so the
 * key would become `${operation}:${region}` and each (operation, region) pair
 * gets its own bucket. The rest of the code already keys buckets by an opaque
 * string, so this expansion is a one-line change here.
 */
export function rateLimitKey(operation: SpApiOperation, region?: string): string {
  return region ? `${operation}:${region}` : operation;
}
