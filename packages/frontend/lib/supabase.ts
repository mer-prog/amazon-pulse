/**
 * Supabase client for the public demo dashboard.
 *
 * IMPORTANT — this file uses ONLY the `anon` key. The anon key is safe to ship
 * to the browser BECAUSE every demo-readable table has a RLS policy of the
 * form `is_demo = true` (see infrastructure/supabase/migrations/0003_*).
 * Real customer data stays invisible. The service-role key never reaches the
 * browser; it lives in the Cloudflare Worker secrets and the local pipeline
 * env only.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function readSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required ' +
        'for the frontend. See packages/frontend/.env.example.',
    );
  }
  return { url, anonKey };
}

export function createDemoClient(env: SupabaseEnv = readSupabaseEnv()): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-amazon-pulse-client': 'demo-frontend' } },
  });
}
