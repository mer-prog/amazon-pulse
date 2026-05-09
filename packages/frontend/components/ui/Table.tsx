import type { HTMLAttributes, TableHTMLAttributes } from 'react';

export function Table({ className = '', ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y divide-ink-200 text-sm ${className}`} {...rest} />
    </div>
  );
}

export function THead({ className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-ink-50 ${className}`} {...rest} />;
}

export function Th({ className = '', ...rest }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 ${className}`}
      {...rest}
    />
  );
}

export function TBody({ className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`divide-y divide-ink-100 ${className}`} {...rest} />;
}

export function Td({ className = '', ...rest }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={`whitespace-nowrap px-3 py-2 text-ink-700 ${className}`} {...rest} />;
}
