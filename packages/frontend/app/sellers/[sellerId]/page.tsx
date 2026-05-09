import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createDemoClient } from '../../../lib/supabase';
import {
  listDemoSellers,
  listLatestSyncLogs,
  listSellerMarketplaces,
} from '../../../lib/queries';
import { MarketplaceTable } from '../../../components/MarketplaceTable';
import { Card, CardBody, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { SyncStatusBadge } from '../../../components/SyncStatusBadge';
import { formatDuration, formatRelativeTime, maskSellingPartnerId } from '../../../lib/format';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ sellerId: string }>;
}

export default async function SellerDetailPage({ params }: PageProps) {
  const { sellerId } = await params;
  const client = createDemoClient();

  const sellers = await listDemoSellers(client);
  const seller = sellers.find((s) => s.id === sellerId);
  if (!seller) {
    notFound();
  }

  const [marketplaces, logs] = await Promise.all([
    listSellerMarketplaces(client, [seller.id]),
    listLatestSyncLogs(client, [seller.id], 50),
  ]);

  // Group logs by job_run_id so the most recent orchestrator run is featured.
  const grouped = new Map<string, typeof logs>();
  for (const log of logs) {
    const key = log.jobRunId ?? log.id;
    const list = grouped.get(key) ?? [];
    list.push(log);
    grouped.set(key, list);
  }
  const groupedRuns = Array.from(grouped.entries())
    .map(([runId, items]) => ({ runId, items }))
    .sort((a, b) => {
      const aT = a.items[0]?.startedAt ?? '';
      const bT = b.items[0]?.startedAt ?? '';
      return bT.localeCompare(aT);
    });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-ink-500 hover:text-ink-900">
          ← Dashboard
        </Link>
      </div>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{seller.displayName}</h1>
          <p className="mt-1 font-mono text-xs text-ink-500">
            {maskSellingPartnerId(seller.sellingPartnerId)} · region {seller.region.toUpperCase()}
          </p>
        </div>
        {seller.isActive ? <Badge tone="ok">active</Badge> : <Badge tone="neutral">inactive</Badge>}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Marketplaces · latest sync per job</CardTitle>
        </CardHeader>
        <CardBody>
          <MarketplaceTable marketplaces={marketplaces} logs={logs} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent orchestrator runs</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {groupedRuns.length === 0 ? (
            <p className="text-sm text-ink-500">No sync runs recorded yet.</p>
          ) : (
            groupedRuns.slice(0, 5).map((run) => {
              const sample = run.items[0];
              return (
                <div key={run.runId} className="rounded-md border border-ink-100 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-ink-500">
                      run {run.runId.slice(0, 8)}…
                    </span>
                    {sample ? (
                      <span className="text-xs text-ink-500">
                        {formatRelativeTime(sample.startedAt)}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {run.items.map((log) => (
                      <li key={log.id} className="flex items-center gap-3">
                        <SyncStatusBadge status={log.status} />
                        <span className="font-medium text-ink-700">{log.jobType}</span>
                        <span className="text-ink-500">{log.marketplaceId ?? '—'}</span>
                        <span className="text-ink-500">
                          {log.recordsUpserted ?? 0}/{log.recordsFetched ?? 0} rows
                        </span>
                        <span className="text-ink-500">
                          {formatDuration(log.startedAt, log.finishedAt)}
                        </span>
                        {log.errorMessage ? (
                          <span className="truncate text-rose-600" title={log.errorMessage}>
                            {log.errorCode ?? 'error'}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
    </div>
  );
}
