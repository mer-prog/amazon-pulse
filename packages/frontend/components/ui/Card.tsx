import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-ink-200 bg-white shadow-sm ${className}`}
      {...rest}
    />
  );
}

export function CardHeader({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`border-b border-ink-100 px-5 py-3 ${className}`} {...rest} />;
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-base font-semibold text-ink-900 ${className}`}>{children}</h3>;
}

export function CardBody({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-5 py-4 ${className}`} {...rest} />;
}
