import { SyncStatusBadge } from './SyncStatusBadge';
import { TBody, THead, Table, Td, Th } from './ui/Table';
import { flagFor, formatDuration, formatRelativeTime } from '../lib/format';
import type { SellerMarketplaceRow, SyncLogRow } from '../lib/queries';

interface Props {
  marketplaces: SellerMarketplaceRow[];
  logs: SyncLogRow[];
}

interface MarketplaceJobs {
  marketplaceId: string;
  countryCode: string;
  defaultCurrency: string;
  byJob: Map<SyncLogRow['jobType'], SyncLogRow>;
}

function buildRows(marketplaces: SellerMarketplaceRow[], logs: SyncLogRow[]): MarketplaceJobs[] {
  // For each marketplace, pick the most recent log per job_type.
  const result: MarketplaceJobs[] = marketplaces.map((m) => ({
    marketplaceId: m.marketplaceId,
    countryCode: m.countryCode,
    defaultCurrency: m.defaultCurrency,
    byJob: new Map(),
  }));
  const byMarketplace = new Map(result.map((r) => [r.marketplaceId, r]));
  for (const log of logs) {
    if (!log.marketplaceId) continue;
    const row = byMarketplace.get(log.marketplaceId);
    if (!row) continue;
    if (!row.byJob.has(log.jobType)) {
      // logs arrive sorted by started_at desc
      row.byJob.set(log.jobType, log);
    }
  }
  return result;
}

const JOBS: SyncLogRow['jobType'][] = ['orders', 'inventory', 'sales_reports', 'products'];

export function MarketplaceTable({ marketplaces, logs }: Props) {
  const rows = buildRows(marketplaces, logs);
  if (rows.length === 0) {
    return <p className="text-sm text-ink-500">No marketplaces configured for this seller.</p>;
  }
  return (
    <Table>
      <THead>
        <tr>
          <Th>Marketplace</Th>
          {JOBS.map((j) => (
            <Th key={j}>{j}</Th>
          ))}
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <tr key={r.marketplaceId}>
            <Td>
              <span className="mr-1.5" aria-hidden>{flagFor(r.countryCode)}</span>
              <span className="font-medium text-ink-900">{r.countryCode}</span>
              <span className="ml-2 font-mono text-xs text-ink-500">{r.marketplaceId}</span>
            </Td>
            {JOBS.map((job) => {
              const log = r.byJob.get(job);
              if (!log) {
                return (
                  <Td key={job}>
                    <span className="text-ink-300">—</span>
                  </Td>
                );
              }
              return (
                <Td key={job}>
                  <div className="flex items-center gap-2">
                    <SyncStatusBadge status={log.status} />
                    <span className="text-xs text-ink-500" title={log.startedAt}>
                      {formatRelativeTime(log.startedAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {log.recordsUpserted ?? 0} rows · {formatDuration(log.startedAt, log.finishedAt)}
                  </div>
                  {log.errorMessage ? (
                    <div
                      className="mt-0.5 max-w-[18rem] truncate text-xs text-rose-600"
                      title={log.errorMessage}
                    >
                      {log.errorCode ?? 'error'}: {log.errorMessage}
                    </div>
                  ) : null}
                </Td>
              );
            })}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
