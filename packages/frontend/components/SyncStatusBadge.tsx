import { Badge, type BadgeTone } from './ui/Badge';

export type SyncStatus = 'started' | 'succeeded' | 'failed' | 'partial';

const TONE_BY_STATUS: Readonly<Record<SyncStatus, BadgeTone>> = {
  started:   'info',
  succeeded: 'ok',
  partial:   'warn',
  failed:    'bad',
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const tone = TONE_BY_STATUS[status] ?? 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}
