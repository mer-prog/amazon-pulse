/**
 * The "this is a demo" banner that's pinned across the dashboard.
 * Wording is deliberate: it (a) establishes credibility (we're not pretending
 * the SP-API integration is live), and (b) leaves the door open for a paid
 * production engagement.
 */
export function DemoBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        <p>
          <strong className="font-semibold">Sandbox Demo</strong>
          <span className="mx-2 text-amber-700">·</span>
          Connected to SP-API Sandbox endpoint. Production credentials require a separate engagement.
        </p>
      </div>
    </div>
  );
}
