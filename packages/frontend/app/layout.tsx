import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { DemoBanner } from '../components/DemoBanner';

export const metadata: Metadata = {
  title: 'amazon-pulse — SP-API sandbox dashboard',
  description:
    'Production-grade Selling Partner API data pipeline for Amazon EU/UK sellers. ' +
    'Sandbox demo build.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <DemoBanner />
        <header className="border-b border-ink-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-lg font-semibold text-ink-900">amazon-</span>
              <span className="font-mono text-lg font-semibold text-accent">pulse</span>
              <span className="hidden text-sm text-ink-500 sm:inline">
                · SP-API data pipeline (EU/UK)
              </span>
            </div>
            <a
              className="text-sm text-ink-500 hover:text-ink-900"
              href="https://github.com/mer-prog/amazon-pulse"
              target="_blank"
              rel="noopener noreferrer"
            >
              github →
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-ink-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-ink-500">
            Sandbox demo build · No live SP-API credentials are used. All seller data shown is
            synthetic.
          </div>
        </footer>
      </body>
    </html>
  );
}
