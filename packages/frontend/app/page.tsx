import { createDemoClient } from '../lib/supabase';
import { loadDashboardSummary, type SellerSummary } from '../lib/queries';
import { SellerCard } from '../components/SellerCard';

export const runtime = 'edge';

// Always render server-side at request time so the dashboard reflects the
// most recent sync_logs (cron writes happen out-of-band).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  let summaries: SellerSummary[] = [];
  let loadError: string | null = null;
  try {
    const client = createDemoClient();
    summaries = await loadDashboardSummary(client);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold text-ink-900">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Connected demo sellers and the latest result of each scheduled sync run.
        </p>
      </section>

      {loadError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-medium">Could not load dashboard data.</p>
          <p className="mt-1 text-xs text-rose-700">{loadError}</p>
          <p className="mt-2 text-xs text-rose-700">
            Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{' '}
            <code className="font-mono">.env.local</code>, then run the migrations + seed in{' '}
            <code className="font-mono">infrastructure/supabase</code>.
          </p>
        </div>
      ) : summaries.length === 0 ? (
        <div className="rounded-md border border-ink-200 bg-white px-4 py-6 text-sm text-ink-500">
          No demo sellers found. Apply <code>infrastructure/supabase/seed.sql</code> to populate
          the sandbox dataset.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {summaries.map((s) => (
            <SellerCard key={s.seller.id} summary={s} />
          ))}
        </div>
      )}
    </div>
  );
}
