/**
 * Thin SP-API HTTP client.
 *
 * Auth: LWA access token only (no AWS SigV4 — Amazon dropped SigV4 for SP-API
 * in 2023). Tokens are fetched via getValidAccessToken() with per-seller
 * caching.
 *
 * Resilience: every operation runs through `executeWithRateLimit`, which
 * gates outbound calls on a per-operation token bucket pre-loaded with the
 * SP-API published default rate / burst values. axios-retry handles transient
 * 429 / 5xx / network errors with exponential backoff; on a 429 it also
 * drains the relevant bucket for the back-off duration so concurrent in-flight
 * calls for the same operation don't keep firing while we're being throttled.
 */

import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosRequestConfig,
} from 'axios';
import axiosRetry from 'axios-retry';
import { getValidAccessToken, type LwaCredentials } from './lwa-auth.js';
import {
  SP_API_RATE_LIMITS,
  rateLimitKey,
  type RateLimitSpec,
  type SpApiOperation,
} from './rate-limits.js';
import { TokenBucket, type TokenBucketOptions } from './token-bucket.js';
import {
  GetOrdersResponseSchema,
  GetOrderItemsResponseSchema,
  type GetOrdersResponse,
  type GetOrderItemsResponse,
} from '../schemas/orders.js';
import {
  GetInventorySummariesResponseSchema,
  type GetInventorySummariesResponse,
} from '../schemas/inventory.js';
import {
  CreateReportResponseSchema,
  ReportDocumentSchema,
  ReportSchema,
  type CreateReportResponse,
  type Report,
  type ReportDocument,
} from '../schemas/reports.js';
import {
  SearchCatalogItemsResponseSchema,
  type SearchCatalogItemsResponse,
} from '../schemas/catalog.js';

export interface SpApiClientOptions {
  /** SP-API endpoint. Defaults to the EU sandbox. */
  endpoint?: string;
  /** Cache key for the access token (typically the seller id). */
  cacheKey: string;
  /** Encrypted refresh token, decrypted before being passed in. */
  refreshToken: string;
  /** LWA app credentials. */
  credentials: LwaCredentials;
  /** Retries on 429 / 5xx / network errors. Default: 3. */
  retries?: number;
  /**
   * Override the per-operation rate / burst defaults. Primarily for tests
   * that want a tighter or looser bucket than the production-tuned values.
   */
  rateLimits?: Partial<Record<SpApiOperation, RateLimitSpec>>;
  /**
   * Test seam for the token buckets — lets tests inject a mock clock and
   * timers so they can verify rate-limit behaviour without real waits.
   */
  tokenBucketOptions?: Pick<TokenBucketOptions, 'now' | 'setTimer' | 'clearTimer'>;
  /**
   * Test seam: custom axios adapter that answers requests without real
   * network traffic. axios-retry's response interceptor still runs on top of
   * whatever this adapter returns / rejects, so retry and 429 handling can be
   * exercised end-to-end.
   */
  httpAdapter?: AxiosAdapter;
}

export interface GetOrdersParams {
  marketplaceIds: string[];
  createdAfter?: string;
  createdBefore?: string;
  lastUpdatedAfter?: string;
  lastUpdatedBefore?: string;
  orderStatuses?: string[];
  fulfillmentChannels?: string[];
  maxResultsPerPage?: number;
  nextToken?: string;
}

export interface GetOrderItemsParams {
  amazonOrderId: string;
  nextToken?: string;
}

export interface GetInventorySummariesParams {
  marketplaceIds: string[];
  granularityType?: 'Marketplace';
  granularityId?: string;
  details?: boolean;
  sellerSkus?: string[];
  nextToken?: string;
}

export interface CreateReportParams {
  reportType: string;
  marketplaceIds: string[];
  dataStartTime?: string;
  dataEndTime?: string;
  reportOptions?: Record<string, string>;
}

export interface SearchCatalogItemsParams {
  marketplaceIds: string[];
  identifiers?: string[];
  identifiersType?: 'ASIN' | 'EAN' | 'GTIN' | 'ISBN' | 'JAN' | 'MINSAN' | 'SKU' | 'UPC';
  includedData?: Array<'attributes' | 'images' | 'productTypes' | 'salesRanks' | 'summaries'>;
  pageSize?: number;
  pageToken?: string;
}

const DEFAULT_SANDBOX_EU = 'https://sandbox.sellingpartnerapi-eu.amazon.com';

/**
 * Custom (non-axios) request-config field used to tag each outbound request
 * with its SP-API operation, so the axios-retry retryDelay callback can find
 * the right token bucket to drain on a 429. Kept off the wire by axios.
 */
const OP_FIELD = '__spApiOperation' as const;
type TaggedConfig = AxiosRequestConfig & { [OP_FIELD]?: SpApiOperation };

function pickEndpoint(opts: SpApiClientOptions): string {
  return opts.endpoint ?? process.env.SP_API_ENDPOINT ?? DEFAULT_SANDBOX_EU;
}

export class SpApiClient {
  private readonly http: AxiosInstance;
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly opts: SpApiClientOptions) {
    this.http = axios.create({
      baseURL: pickEndpoint(opts),
      timeout: 30_000,
      ...(opts.httpAdapter ? { adapter: opts.httpAdapter } : {}),
    });
    axiosRetry(this.http, {
      retries: opts.retries ?? 3,
      retryDelay: (retryCount, error) => {
        const delayMs = axiosRetry.exponentialDelay(retryCount, error);
        if (error.response?.status === 429) {
          const op = (error.config as TaggedConfig | undefined)?.[OP_FIELD];
          if (op) this.bucketFor(op).drain(delayMs);
        }
        return delayMs;
      },
      retryCondition: (err) => {
        if (axiosRetry.isNetworkError(err)) return true;
        const status = err.response?.status;
        return typeof status === 'number' && (status === 429 || status >= 500);
      },
    });
  }

  private bucketFor(operation: SpApiOperation): TokenBucket {
    const key = rateLimitKey(operation);
    const existing = this.buckets.get(key);
    if (existing) return existing;
    const spec = this.opts.rateLimits?.[operation] ?? SP_API_RATE_LIMITS[operation];
    const bucket = new TokenBucket({
      rate: spec.rate,
      burst: spec.burst,
      ...(this.opts.tokenBucketOptions ?? {}),
    });
    this.buckets.set(key, bucket);
    return bucket;
  }

  /**
   * Wait for the operation's bucket to admit a request, then issue it through
   * the shared (retry-equipped) axios instance. The operation tag is attached
   * to `config` so the 429 path in `retryDelay` can drain the same bucket.
   */
  private async executeWithRateLimit<T>(
    operation: SpApiOperation,
    cfg: AxiosRequestConfig,
  ): Promise<T> {
    await this.bucketFor(operation).waitForToken();
    const tagged: TaggedConfig = { ...cfg };
    tagged[OP_FIELD] = operation;
    const response = await this.http.request<T>(tagged);
    return response.data;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await getValidAccessToken(
      this.opts.cacheKey,
      this.opts.refreshToken,
      this.opts.credentials,
    );
    return {
      'x-amz-access-token': token,
      Accept: 'application/json',
    };
  }

  // ── Orders v0 ────────────────────────────────────────────────────────────

  async getOrders(params: GetOrdersParams): Promise<GetOrdersResponse> {
    if (!params.createdAfter && !params.lastUpdatedAfter) {
      throw new Error('getOrders requires either createdAfter or lastUpdatedAfter');
    }
    const headers = await this.authHeaders();
    const query: Record<string, string | number> = {
      MarketplaceIds: params.marketplaceIds.join(','),
    };
    if (params.createdAfter) query['CreatedAfter'] = params.createdAfter;
    if (params.createdBefore) query['CreatedBefore'] = params.createdBefore;
    if (params.lastUpdatedAfter) query['LastUpdatedAfter'] = params.lastUpdatedAfter;
    if (params.lastUpdatedBefore) query['LastUpdatedBefore'] = params.lastUpdatedBefore;
    if (params.orderStatuses?.length) query['OrderStatuses'] = params.orderStatuses.join(',');
    if (params.fulfillmentChannels?.length) {
      query['FulfillmentChannels'] = params.fulfillmentChannels.join(',');
    }
    if (params.maxResultsPerPage !== undefined) {
      query['MaxResultsPerPage'] = params.maxResultsPerPage;
    }
    if (params.nextToken) query['NextToken'] = params.nextToken;

    const data = await this.executeWithRateLimit<unknown>('getOrders', {
      method: 'get',
      url: '/orders/v0/orders',
      headers,
      params: query,
    });
    return GetOrdersResponseSchema.parse(data);
  }

  async getOrderItems(params: GetOrderItemsParams): Promise<GetOrderItemsResponse> {
    const headers = await this.authHeaders();
    const query: Record<string, string> = {};
    if (params.nextToken) query['NextToken'] = params.nextToken;
    const data = await this.executeWithRateLimit<unknown>('getOrderItems', {
      method: 'get',
      url: `/orders/v0/orders/${encodeURIComponent(params.amazonOrderId)}/orderItems`,
      headers,
      params: query,
    });
    return GetOrderItemsResponseSchema.parse(data);
  }

  // ── FBA Inventory v1 ─────────────────────────────────────────────────────

  async getInventorySummaries(
    params: GetInventorySummariesParams,
  ): Promise<GetInventorySummariesResponse> {
    const headers = await this.authHeaders();
    const granId = params.granularityId ?? params.marketplaceIds[0];
    if (!granId) throw new Error('getInventorySummaries requires at least one marketplaceId');
    const query: Record<string, string | number | boolean> = {
      granularityType: params.granularityType ?? 'Marketplace',
      granularityId: granId,
      marketplaceIds: params.marketplaceIds.join(','),
      details: params.details ?? true,
    };
    if (params.sellerSkus?.length) query['sellerSkus'] = params.sellerSkus.join(',');
    if (params.nextToken) query['nextToken'] = params.nextToken;
    const data = await this.executeWithRateLimit<unknown>('getInventorySummaries', {
      method: 'get',
      url: '/fba/inventory/v1/summaries',
      headers,
      params: query,
    });
    return GetInventorySummariesResponseSchema.parse(data);
  }

  // ── Reports 2021-06-30 ───────────────────────────────────────────────────

  async createReport(params: CreateReportParams): Promise<CreateReportResponse> {
    const headers = { ...(await this.authHeaders()), 'Content-Type': 'application/json' };
    const body: Record<string, unknown> = {
      reportType: params.reportType,
      marketplaceIds: params.marketplaceIds,
    };
    if (params.dataStartTime) body['dataStartTime'] = params.dataStartTime;
    if (params.dataEndTime) body['dataEndTime'] = params.dataEndTime;
    if (params.reportOptions) body['reportOptions'] = params.reportOptions;
    const data = await this.executeWithRateLimit<unknown>('createReport', {
      method: 'post',
      url: '/reports/2021-06-30/reports',
      headers,
      data: body,
    });
    return CreateReportResponseSchema.parse(data);
  }

  async getReport(reportId: string): Promise<Report> {
    const headers = await this.authHeaders();
    const data = await this.executeWithRateLimit<unknown>('getReport', {
      method: 'get',
      url: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      headers,
    });
    return ReportSchema.parse(data);
  }

  async getReportDocument(reportDocumentId: string): Promise<ReportDocument> {
    const headers = await this.authHeaders();
    const data = await this.executeWithRateLimit<unknown>('getReportDocument', {
      method: 'get',
      url: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
      headers,
    });
    return ReportDocumentSchema.parse(data);
  }

  /**
   * Download the raw report payload from the presigned S3 URL returned by
   * getReportDocument. Returns the response body as a string. Caller is
   * responsible for parsing (JSON / TSV / etc) and gunzipping if compressed.
   *
   * Not rate-limited here: the URL points at S3, not SP-API, and doesn't
   * count against any SP-API usage plan.
   */
  async downloadReportDocumentText(url: string): Promise<string> {
    const { data } = await axios.get<string>(url, {
      timeout: 60_000,
      responseType: 'text',
      transformResponse: (raw) => raw,
    });
    return data;
  }

  // ── Catalog Items 2022-04-01 ─────────────────────────────────────────────

  async searchCatalogItems(
    params: SearchCatalogItemsParams,
  ): Promise<SearchCatalogItemsResponse> {
    const headers = await this.authHeaders();
    const query: Record<string, string | number> = {
      marketplaceIds: params.marketplaceIds.join(','),
    };
    if (params.identifiers?.length) {
      query['identifiers'] = params.identifiers.join(',');
      query['identifiersType'] = params.identifiersType ?? 'ASIN';
    }
    if (params.includedData?.length) query['includedData'] = params.includedData.join(',');
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;
    if (params.pageToken) query['pageToken'] = params.pageToken;
    const data = await this.executeWithRateLimit<unknown>('searchCatalogItems', {
      method: 'get',
      url: '/catalog/2022-04-01/items',
      headers,
      params: query,
    });
    return SearchCatalogItemsResponseSchema.parse(data);
  }
}
