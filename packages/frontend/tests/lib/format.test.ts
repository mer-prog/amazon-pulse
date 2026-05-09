import { describe, expect, it } from 'vitest';
import {
  flagFor,
  formatDuration,
  formatRelativeTime,
  maskSellingPartnerId,
} from '../../lib/format';

describe('flagFor', () => {
  it('maps EU/UK country codes to flag emojis', () => {
    expect(flagFor('DE')).toBe('🇩🇪');
    expect(flagFor('gb')).toBe('🇬🇧'); // case-insensitive
    expect(flagFor('UK')).toBe('🇬🇧'); // alias
  });

  it('returns a fallback flag for unknown codes', () => {
    expect(flagFor('ZZ')).toBe('🏳️');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-09T12:00:00Z');

  it('returns dash for null/empty', () => {
    expect(formatRelativeTime(null, now)).toBe('—');
    expect(formatRelativeTime(undefined, now)).toBe('—');
    expect(formatRelativeTime('not-a-date', now)).toBe('—');
  });

  it('reports seconds, minutes, hours, days', () => {
    expect(formatRelativeTime('2026-05-09T11:59:30Z', now)).toBe('30s ago');
    expect(formatRelativeTime('2026-05-09T11:30:00Z', now)).toBe('30m ago');
    expect(formatRelativeTime('2026-05-09T08:00:00Z', now)).toBe('4h ago');
    expect(formatRelativeTime('2026-05-06T12:00:00Z', now)).toBe('3d ago');
  });

  it('falls back to ISO date for older timestamps', () => {
    expect(formatRelativeTime('2026-04-01T00:00:00Z', now)).toBe('2026-04-01');
  });

  it('handles future timestamps gracefully', () => {
    expect(formatRelativeTime('2026-05-10T00:00:00Z', now)).toBe('in the future');
  });
});

describe('formatDuration', () => {
  it('returns dash when end is missing', () => {
    expect(formatDuration('2026-05-09T12:00:00Z', null)).toBe('—');
  });

  it('shows ms under 1 second', () => {
    expect(formatDuration('2026-05-09T12:00:00.000Z', '2026-05-09T12:00:00.420Z')).toBe('420ms');
  });

  it('shows seconds with one decimal', () => {
    expect(formatDuration('2026-05-09T12:00:00Z', '2026-05-09T12:00:12Z')).toBe('12.0s');
  });

  it('returns dash for negative durations', () => {
    expect(formatDuration('2026-05-09T12:00:01Z', '2026-05-09T12:00:00Z')).toBe('—');
  });
});

describe('maskSellingPartnerId', () => {
  it('keeps short ids untouched', () => {
    expect(maskSellingPartnerId('SHORT')).toBe('SHORT');
  });

  it('keeps the head and tail visible', () => {
    const masked = maskSellingPartnerId('A1DEMOSELLER001');
    expect(masked.startsWith('A1DE')).toBe(true);
    expect(masked.endsWith('01')).toBe(true);
    expect(masked).not.toContain('MOSELLER0');
  });
});
