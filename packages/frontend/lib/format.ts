/**
 * Pure formatting helpers. Kept tiny and dependency-free so they can be unit
 * tested without rendering React.
 */

const COUNTRY_FLAGS: Readonly<Record<string, string>> = {
  DE: '🇩🇪',
  FR: '🇫🇷',
  IT: '🇮🇹',
  ES: '🇪🇸',
  GB: '🇬🇧',
  UK: '🇬🇧',
  NL: '🇳🇱',
  BE: '🇧🇪',
  IE: '🇮🇪',
  SE: '🇸🇪',
  PL: '🇵🇱',
  TR: '🇹🇷',
};

export function flagFor(countryCode: string): string {
  const upper = countryCode.toUpperCase();
  return COUNTRY_FLAGS[upper] ?? '🏳️';
}

export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return 'in the future';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  // Older than 14 days — show the date.
  return new Date(iso).toISOString().slice(0, 10);
}

export function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function maskSellingPartnerId(id: string): string {
  // Keep first 4 + last 2 chars; mask the middle so screenshots are safe to share.
  if (id.length <= 6) return id;
  const head = id.slice(0, 4);
  const tail = id.slice(-2);
  return `${head}${'•'.repeat(Math.max(3, id.length - 6))}${tail}`;
}
