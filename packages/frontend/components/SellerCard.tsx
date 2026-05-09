import Link from 'next/link';
import { Badge } from './ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from './ui/Card';
import { SyncStatusBadge } from './SyncStatusBadge';
import { flagFor, formatRelativeTime, maskSellingPartnerId } from '../lib/format';
import type { SellerSummary } from '../lib/queries';

function summarize(latestLogs: SellerSummary['latestLogs']) {
  const total = latestLogs.length;
  const succeeded = latestLogs.filter((l) => l.status === 'succeeded').length;
  const failed = latestLogs.filter((l) => l.status === 'failed').length;
  const partial = latestLogs.filter((l) => l.status === 'partial').length;
  const lastStartedAt = latestLogs[0]?.startedAt ?? null;
  return { total, succeeded, failed, partial, lastStartedAt };
}

export function SellerCard({ summary }: { summary: SellerSummary }) {
  const { seller, marketplaces, latestLogs } = summary;
  const stats = summarize(latestLogs);
  const latest = latestLogs[0];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <CardTitle>{seller.displayName}</CardTitle>
          <p className="font-mono text-xs text-ink-500">
            {maskSellingPartnerId(seller.sellingPartnerId)} · {seller.region.toUpperCase()}
          </p>
        </div>
        {seller.isActive ? <Badge tone="ok">active</Badge> : <Badge tone="neutral">inactive</Badge>}
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {marketplaces.length === 0 ? (
            <span className="text-xs text-ink-500">no marketplaces configured</span>
          ) : (
            marketplaces.map((m) => (
              <span
                key={m.marketplaceId}
                className="inline-flex items-center gap-1 rounded-md bg-ink-50 px-2 py-0.5 text-xs text-ink-700"
                title={`${m.marketplaceId} · ${m.defaultCurrency}`}
              >
                <span aria-hidden>{flagFor(m.countryCode)}</span>
                {m.countryCode}
              </span>
            ))
          )}
        </div>

        <dl className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-ink-500">recent runs</dt>
            <dd className="font-mono text-base text-ink-900">{stats.total}</dd>
          </div>
          <div>
            <dt className="text-ink-500">succeeded</dt>
            <dd className="font-mono text-base text-emerald-700">{stats.succeeded}</dd>
          </div>
          <div>
            <dt className="text-ink-500">failed</dt>
            <dd className="font-mono text-base text-rose-700">{stats.failed + stats.partial}</dd>
          </div>
        </dl>

        <div className="flex items-center justify-between border-t border-ink-100 pt-3 text-xs text-ink-500">
          <span>
            last sync: <span className="text-ink-700">{formatRelativeTime(stats.lastStartedAt)}</span>
            {latest ? (
              <>
                {' '}
                · {latest.jobType} <SyncStatusBadge status={latest.status} />
              </>
            ) : null}
          </span>
          <Link
            href={`/sellers/${seller.id}`}
            className="font-medium text-ink-700 hover:text-accent-dark"
          >
            details →
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
