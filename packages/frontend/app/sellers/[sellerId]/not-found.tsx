import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold text-ink-900">Seller not found</h1>
      <p className="text-sm text-ink-500">
        This seller does not exist, or has not been published to the demo dataset.
      </p>
      <Link href="/" className="text-sm text-ink-700 hover:text-accent-dark">
        ← Back to dashboard
      </Link>
    </div>
  );
}
