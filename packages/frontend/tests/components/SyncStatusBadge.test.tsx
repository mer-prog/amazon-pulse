import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncStatusBadge } from '../../components/SyncStatusBadge';

describe('SyncStatusBadge', () => {
  it.each([
    ['succeeded', 'emerald'],
    ['failed', 'rose'],
    ['partial', 'amber'],
    ['started', 'sky'],
  ] as const)('renders %s with the right tone class', (status, hue) => {
    render(<SyncStatusBadge status={status} />);
    const badge = screen.getByText(status);
    expect(badge).toBeInTheDocument();
    // Tone is encoded via Tailwind color classes (e.g. bg-emerald-50)
    expect(badge.className).toContain(hue);
  });
});
