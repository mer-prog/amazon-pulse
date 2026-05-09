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
  type GetOrdersResponse,
} from '../schemas/orders.js';

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

  /**
   * GET /orders/v0/orders — list orders for one or more marketplaces.
   * At least one of CreatedAfter / LastUpdatedAfter is required by the API.
   */
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

    const { data } = await this.http.get('/orders/v0/orders', {
      headers,
      params: query,
    });
    return GetOrdersResponseSchema.parse(data);
  }
}
