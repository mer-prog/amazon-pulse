/**
 * Thin SP-API HTTP client.
 *
 * Auth: LWA access token only (no AWS SigV4 — Amazon dropped SigV4 for SP-API
 * in 2023). Tokens are fetched via getValidAccessToken() with per-seller
 * caching.
 *
 * Resilience: axios-retry handles transient 429 / 5xx / network errors with
 * exponential backoff. Long-form rate limiting (token-bucket per operation)
 * lands in Phase 3.
 */

import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { getValidAccessToken, type LwaCredentials } from './lwa-auth.js';
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

function pickEndpoint(opts: SpApiClientOptions): string {
  return opts.endpoint ?? process.env.SP_API_ENDPOINT ?? DEFAULT_SANDBOX_EU;
}

export class SpApiClient {
  private readonly http: AxiosInstance;

  constructor(private readonly opts: SpApiClientOptions) {
    this.http = axios.create({
      baseURL: pickEndpoint(opts),
      timeout: 30_000,
    });
    axiosRetry(this.http, {
      retries: opts.retries ?? 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) => {
        if (axiosRetry.isNetworkError(err)) return true;
        const status = err.response?.status;
        return typeof status === 'number' && (status === 429 || status >= 500);
      },
    });
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

    const { data } = await this.http.get('/orders/v0/orders', { headers, params: query });
    return GetOrdersResponseSchema.parse(data);
  }

  async getOrderItems(params: GetOrderItemsParams): Promise<GetOrderItemsResponse> {
    const headers = await this.authHeaders();
    const query: Record<string, string> = {};
    if (params.nextToken) query['NextToken'] = params.nextToken;
    const { data } = await this.http.get(
      `/orders/v0/orders/${encodeURIComponent(params.amazonOrderId)}/orderItems`,
      { headers, params: query },
    );
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
    const { data } = await this.http.get('/fba/inventory/v1/summaries', {
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
    const { data } = await this.http.post('/reports/2021-06-30/reports', body, { headers });
    return CreateReportResponseSchema.parse(data);
  }

  async getReport(reportId: string): Promise<Report> {
    const headers = await this.authHeaders();
    const { data } = await this.http.get(
      `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      { headers },
    );
    return ReportSchema.parse(data);
  }

  async getReportDocument(reportDocumentId: string): Promise<ReportDocument> {
    const headers = await this.authHeaders();
    const { data } = await this.http.get(
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
      { headers },
    );
    return ReportDocumentSchema.parse(data);
  }

  /**
   * Download the raw report payload from the presigned S3 URL returned by
   * getReportDocument. Returns the response body as a string. Caller is
   * responsible for parsing (JSON / TSV / etc) and gunzipping if compressed.
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
    const { data } = await this.http.get('/catalog/2022-04-01/items', {
      headers,
      params: query,
    });
    return SearchCatalogItemsResponseSchema.parse(data);
  }
}
