import { z } from 'zod';

/**
 * SP-API FBA Inventory v1 — getInventorySummaries.
 * Reference model:
 *   https://github.com/amzn/selling-partner-api-models/blob/main/models/fba-inventory-api-model/fbaInventory.json
 */

const InventoryDetailsSchema = z
  .object({
    fulfillableQuantity: z.number().int().nonnegative().optional(),
    inboundWorkingQuantity: z.number().int().nonnegative().optional(),
    inboundShippedQuantity: z.number().int().nonnegative().optional(),
    inboundReceivingQuantity: z.number().int().nonnegative().optional(),
    reservedQuantity: z
      .object({
        totalReservedQuantity: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
    unfulfillableQuantity: z
      .object({
        totalUnfulfillableQuantity: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const InventorySummarySchema = z
  .object({
    asin: z.string().optional(),
    fnSku: z.string().optional(),
    sellerSku: z.string().min(1),
    condition: z.string().optional(),
    productName: z.string().optional(),
    totalQuantity: z.number().int().nonnegative().optional(),
    lastUpdatedTime: z.string().optional(),
    inventoryDetails: InventoryDetailsSchema.optional(),
  })
  .passthrough();
export type InventorySummary = z.infer<typeof InventorySummarySchema>;

export const GetInventorySummariesResponseSchema = z
  .object({
    payload: z
      .object({
        granularity: z
          .object({ granularityType: z.string(), granularityId: z.string() })
          .passthrough()
          .optional(),
        inventorySummaries: z.array(InventorySummarySchema),
      })
      .passthrough(),
    pagination: z
      .object({ nextToken: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type GetInventorySummariesResponse = z.infer<typeof GetInventorySummariesResponseSchema>;
