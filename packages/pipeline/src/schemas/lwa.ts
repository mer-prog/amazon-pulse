import { z } from 'zod';

/**
 * LWA (Login With Amazon) token endpoint response.
 * Reference: https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
 */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;
