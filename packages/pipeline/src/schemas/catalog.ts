import { z } from 'zod';

/**
 * SP-API Catalog Items 2022-04-01 — searchCatalogItems.
 * Reference model:
 *   https://github.com/amzn/selling-partner-api-models/blob/main/models/catalog-items-api-model/catalogItems_2022-04-01.json
 */

const CatalogImageSchema = z
  .object({
    variant: z.string().optional(),
    link: z.string().url().optional(),
    height: z.number().optional(),
    width: z.number().optional(),
  })
  .passthrough();

const CatalogSummarySchema = z
  .object({
    marketplaceId: z.string(),
    asin: z.string().optional(),
    brand: z.string().optional(),
    itemName: z.string().optional(),
    itemClassification: z.string().optional(),
    manufacturer: z.string().optional(),
  })
  .passthrough();

export const CatalogItemSchema = z
  .object({
    asin: z.string(),
    summaries: z.array(CatalogSummarySchema).optional(),
    images: z
      .array(
        z
          .object({
            marketplaceId: z.string(),
            images: z.array(CatalogImageSchema),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const SearchCatalogItemsResponseSchema = z
  .object({
    items: z.array(CatalogItemSchema),
    pagination: z
      .object({ nextToken: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type SearchCatalogItemsResponse = z.infer<typeof SearchCatalogItemsResponseSchema>;
