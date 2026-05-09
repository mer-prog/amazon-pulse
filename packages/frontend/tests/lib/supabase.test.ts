import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSupabaseEnv } from '../../lib/supabase';

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('readSupabaseEnv', () => {
  it('throws when either env var is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => readSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when only the URL is set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => readSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('returns the env values when both are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123';
    expect(readSupabaseEnv()).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'anon-key-123',
    });
  });
});

// NOTE: createDemoClient itself is a thin wrapper around @supabase/supabase-js
// `createClient`. Exercising it under happy-dom requires polyfilling
// WebSocket (the realtime-js client constructs one eagerly). We deliberately
// don't test the wrapper here — the integration is verified by the e2e
// smoke run against a real Supabase project (see README "Demo" section).
