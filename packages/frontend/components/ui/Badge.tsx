import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  ok:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn:    'bg-amber-50 text-amber-800 ring-amber-200',
  bad:     'bg-rose-50 text-rose-700 ring-rose-200',
  info:    'bg-sky-50 text-sky-700 ring-sky-200',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
