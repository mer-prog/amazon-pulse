/**
 * Supabase service-role client + seller credential loader.
 *
 * The service role key bypasses RLS and is intended ONLY for server-side
 * pipeline workers. Never ship it to the browser / Cloudflare Worker public
 * env — use `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` instead.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from './encryption.js';

let cachedClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

export interface SellerCredentials {
  sellerId: string;
  sellingPartnerId: string;
  region: string;
  /** Decrypted plaintext refresh token. Treat as secret in memory. */
  refreshToken: string;
}

/**
 * Load a seller's decrypted refresh token. Caller is responsible for
 * passing this to `SpApiClient` and not logging the value.
 */
export async function getSellerCredentials(sellerId: string): Promise<SellerCredentials> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('sellers')
    .select('id, selling_partner_id, region, refresh_token_encrypted, is_active')
    .eq('id', sellerId)
    .single();
  if (error) {
    throw new Error(`Failed to fetch seller ${sellerId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Seller ${sellerId} not found`);
  }
  if (!data.is_active) {
    throw new Error(`Seller ${sellerId} is inactive`);
  }
  return {
    sellerId: data.id,
    sellingPartnerId: data.selling_partner_id,
    region: data.region,
    refreshToken: decrypt(data.refresh_token_encrypted),
  };
}

/** Test-only: drop the cached service client (e.g. between tests). */
export function _resetServiceClient(): void {
  cachedClient = null;
}
