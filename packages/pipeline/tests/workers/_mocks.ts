/**
 * Test-only fakes for Supabase + SpApiClient.
 *
 * The fake Supabase client implements just enough of the query-builder shape
 * (`from(table).upsert(rows, opts).select(...)` and `.insert(...)`) for the
 * sync workers to run end-to-end against an in-memory store. It enforces the
 * UNIQUE constraints declared in the schema so we can directly assert
 * idempotency: running the same sync twice must not multiply rows.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InMemoryTableConfig {
  /** Primary-key column. Defaults to 'id'. Server-generates UUIDs on insert. */
  primaryKey?: string;
  /** Composite UNIQUE constraints; each entry is the list of column names. */
  uniques?: string[][];
}

interface Row {
  [k: string]: unknown;
}

class InMemoryTable {
  readonly rows: Row[] = [];
  readonly primaryKey: string;
  readonly uniques: string[][];

  constructor(config: InMemoryTableConfig = {}) {
    this.primaryKey = config.primaryKey ?? 'id';
    this.uniques = config.uniques ?? [];
  }

  matchesUnique(row: Row, candidate: Row, columns: string[]): boolean {
    return columns.every((c) => row[c] === candidate[c]);
  }

  upsert(rows: Row[], onConflict: string | undefined): Row[] {
    const conflictCols = onConflict ? onConflict.split(',').map((c) => c.trim()) : null;
    const upserted: Row[] = [];
    for (const incoming of rows) {
      const stored = { ...incoming };
      let existingIdx = -1;
      if (conflictCols) {
        existingIdx = this.rows.findIndex((r) => this.matchesUnique(r, stored, conflictCols));
      }
      if (existingIdx >= 0) {
        const existing = this.rows[existingIdx]!;
        const merged = { ...existing, ...stored, [this.primaryKey]: existing[this.primaryKey] };
        this.rows[existingIdx] = merged;
        upserted.push(merged);
      } else {
        if (stored[this.primaryKey] === undefined) {
          stored[this.primaryKey] = randomUUID();
        }
        // Defend the other UNIQUE constraints.
        for (const u of this.uniques) {
          if (this.rows.some((r) => this.matchesUnique(r, stored, u))) {
            throw new Error(`UNIQUE violation on (${u.join(',')})`);
          }
        }
        this.rows.push(stored);
        upserted.push(stored);
      }
    }
    return upserted;
  }

  insert(rows: Row[]): Row[] {
    const inserted: Row[] = [];
    for (const incoming of rows) {
      const stored = { ...incoming };
      if (stored[this.primaryKey] === undefined) {
        stored[this.primaryKey] = randomUUID();
      }
      for (const u of this.uniques) {
        if (this.rows.some((r) => this.matchesUnique(r, stored, u))) {
          throw new Error(`UNIQUE violation on (${u.join(',')})`);
        }
      }
      this.rows.push(stored);
      inserted.push(stored);
    }
    return inserted;
  }

  select(filter: Record<string, unknown>, isNotNull: string[] = []): Row[] {
    return this.rows.filter((r) => {
      for (const [k, v] of Object.entries(filter)) {
        if (r[k] !== v) return false;
      }
      for (const k of isNotNull) {
        if (r[k] === null || r[k] === undefined) return false;
      }
      return true;
    });
  }
}

export class FakeSupabase {
  readonly tables: Record<string, InMemoryTable> = {};

  constructor() {
    this.tables['orders'] = new InMemoryTable({
      uniques: [['marketplace_id', 'amazon_order_id']],
    });
    this.tables['order_items'] = new InMemoryTable({
      uniques: [['order_id', 'order_item_id']],
    });
    this.tables['inventory'] = new InMemoryTable({
      uniques: [['seller_id', 'marketplace_id', 'sku']],
    });
    this.tables['products'] = new InMemoryTable({
      uniques: [['seller_id', 'marketplace_id', 'sku']],
    });
    this.tables['sales_reports'] = new InMemoryTable({
      uniques: [['seller_id', 'marketplace_id', 'report_date', 'asin']],
    });
    this.tables['sync_logs'] = new InMemoryTable();
  }

  table(name: string): InMemoryTable {
    const t = this.tables[name];
    if (!t) throw new Error(`unknown table: ${name}`);
    return t;
  }

  asSupabaseClient(): SupabaseClient {
    return makeBuilder(this) as unknown as SupabaseClient;
  }
}

function makeBuilder(fake: FakeSupabase): { from: (table: string) => unknown } {
  return {
    from: (table: string) => new TableBuilder(fake.table(table)),
  };
}

class TableBuilder {
  constructor(private readonly tbl: InMemoryTable) {}

  upsert(
    rows: Row | Row[],
    opts?: { onConflict?: string },
  ): SelectBuilder {
    const arr = Array.isArray(rows) ? rows : [rows];
    const result = this.tbl.upsert(arr, opts?.onConflict);
    return new SelectBuilder(result);
  }

  insert(rows: Row | Row[]): SelectBuilder {
    const arr = Array.isArray(rows) ? rows : [rows];
    const result = this.tbl.insert(arr);
    return new SelectBuilder(result);
  }

  select(_columns?: string): FilterBuilder {
    return new FilterBuilder(this.tbl, {}, []);
  }
}

class FilterBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  constructor(
    private readonly tbl: InMemoryTable,
    private readonly filter: Record<string, unknown>,
    private readonly notNull: string[],
  ) {}

  eq(column: string, value: unknown): FilterBuilder {
    return new FilterBuilder(this.tbl, { ...this.filter, [column]: value }, this.notNull);
  }

  not(column: string, _op: 'is', _value: null): FilterBuilder {
    return new FilterBuilder(this.tbl, this.filter, [...this.notNull, column]);
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.tbl.select(this.filter, this.notNull);
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class SelectBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  constructor(private readonly rows: Row[]) {}

  select(_columns?: string): SelectBuilder {
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}
