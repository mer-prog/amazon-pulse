import { z } from 'zod';

/**
 * SP-API Orders v0 response schemas.
 * Reference model:
 *   https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/ordersV0.json
 *
 * `.passthrough()` is applied so future Amazon-side additions don't fail
 * validation. Only the fields we explicitly consume are pinned.
 */

export const MoneySchema = z
  .object({
    CurrencyCode: z.string().length(3),
    Amount: z.string(),
  })
  .passthrough();
export type Money = z.infer<typeof MoneySchema>;

export const AddressSchema = z
  .object({
    Name: z.string().optional(),
    CountryCode: z.string().optional(),
    StateOrRegion: z.string().optional(),
    City: z.string().optional(),
    PostalCode: z.string().optional(),
  })
  .passthrough();
export type Address = z.infer<typeof AddressSchema>;

export const OrderSchema = z
  .object({
    AmazonOrderId: z.string(),
    PurchaseDate: z.string(),
    LastUpdateDate: z.string().optional(),
    OrderStatus: z.string(),
    FulfillmentChannel: z.string().optional(),
    SalesChannel: z.string().optional(),
    OrderTotal: MoneySchema.optional(),
    NumberOfItemsShipped: z.number().int().nonnegative().optional(),
    NumberOfItemsUnshipped: z.number().int().nonnegative().optional(),
    MarketplaceId: z.string().optional(),
    BuyerInfo: z
      .object({ BuyerEmail: z.string().optional() })
      .passthrough()
      .optional(),
    ShippingAddress: AddressSchema.optional(),
    IsPremiumOrder: z.boolean().optional(),
    IsBusinessOrder: z.boolean().optional(),
  })
  .passthrough();
export type Order = z.infer<typeof OrderSchema>;

export const GetOrdersPayloadSchema = z
  .object({
    Orders: z.array(OrderSchema),
    NextToken: z.string().optional(),
    LastUpdatedBefore: z.string().optional(),
    CreatedBefore: z.string().optional(),
  })
  .passthrough();

export const GetOrdersResponseSchema = z
  .object({
    payload: GetOrdersPayloadSchema,
  })
  .passthrough();
export type GetOrdersResponse = z.infer<typeof GetOrdersResponseSchema>;
