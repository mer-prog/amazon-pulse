export { encrypt, decrypt } from './lib/encryption.js';
export {
  exchangeAuthorizationCode,
  refreshAccessToken,
  getValidAccessToken,
  type LwaCredentials,
} from './lib/lwa-auth.js';
export {
  SpApiClient,
  type SpApiClientOptions,
  type GetOrdersParams,
  type GetOrderItemsParams,
  type GetInventorySummariesParams,
  type CreateReportParams,
  type SearchCatalogItemsParams,
} from './lib/sp-api-client.js';
export {
  getServiceClient,
  getSellerCredentials,
  type SellerCredentials,
} from './lib/supabase-client.js';
export {
  newJobRunId,
  runMarketplaceSync,
  writeSyncLog,
  type SyncContext,
  type SyncJobType,
  type SyncStatus,
  type MarketplaceSyncResult,
} from './lib/sync-helpers.js';

export {
  syncOrdersForMarketplace,
  syncOrdersForSeller,
  type OrdersSyncContext,
  type OrdersSyncOptions,
} from './workers/sync-orders.js';
export {
  syncInventoryForMarketplace,
  syncInventoryForSeller,
  type InventorySyncContext,
} from './workers/sync-inventory.js';
export {
  syncSalesReportsForMarketplace,
  syncSalesReportsForSeller,
  type SalesReportsSyncContext,
  type SalesReportsSyncOptions,
} from './workers/sync-sales-reports.js';
export {
  syncProductsForMarketplace,
  syncProductsForSeller,
  type ProductsSyncContext,
  type ProductsSyncOptions,
} from './workers/sync-products.js';

export type { TokenResponse } from './schemas/lwa.js';
export type { Order, OrderItem, GetOrdersResponse, Money, Address } from './schemas/orders.js';
export type {
  InventorySummary,
  GetInventorySummariesResponse,
} from './schemas/inventory.js';
export type {
  Report,
  ReportDocument,
  CreateReportResponse,
  ReportProcessingStatus,
  SalesAndTrafficReport,
  SalesAndTrafficByAsinRow,
} from './schemas/reports.js';
export type { CatalogItem, SearchCatalogItemsResponse } from './schemas/catalog.js';
