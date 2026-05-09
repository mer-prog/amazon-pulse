-- ─────────────────────────────────────────────────────────────────────────────
-- amazon-pulse / 0002_phase2_sync_columns.sql
--
-- Sync-column refactor for the Phase 2 workers:
--   - Separate "Amazon-side last update" from "pipeline-side last sync".
--       updated_at  ← Amazon's LastUpdateDate (or equivalent), nullable
--       synced_at   ← when the pipeline last upserted the row (pipeline-managed)
--   - Drop the auto-update triggers on data tables; workers now set updated_at
--     explicitly from the upstream payload.
--   - sync_logs gains job_run_id so a single orchestrator run produces N logs
--     (one per (seller, marketplace)) that share an id.
--   - sales_reports switches its uniqueness key to ASIN (the granularity that
--     SP-API's GET_SALES_AND_TRAFFIC_REPORT actually emits).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Drop pipeline-side auto-update triggers on data tables ─────────────────
drop trigger if exists orders_set_updated_at    on public.orders;
drop trigger if exists products_set_updated_at  on public.products;
drop trigger if exists inventory_set_updated_at on public.inventory;
-- (sellers keeps its trigger; sellers.updated_at remains pipeline-managed.)

-- ── orders ─────────────────────────────────────────────────────────────────
-- Consolidate Amazon's LastUpdateDate into updated_at, drop the redundant col.
update public.orders set updated_at = coalesce(last_update_date, updated_at);
alter table public.orders drop column last_update_date;
alter table public.orders alter column updated_at drop not null;
alter table public.orders alter column updated_at drop default;

alter table public.orders rename column fetched_at to synced_at;

-- ── products ──────────────────────────────────────────────────────────────
alter table public.products alter column updated_at drop not null;
alter table public.products alter column updated_at drop default;
alter table public.products rename column fetched_at to synced_at;

-- ── inventory ─────────────────────────────────────────────────────────────
alter table public.inventory alter column updated_at drop not null;
alter table public.inventory alter column updated_at drop default;
alter table public.inventory rename column fetched_at to synced_at;

-- ── sales_reports ─────────────────────────────────────────────────────────
-- Add the same separation for sales_reports.
alter table public.sales_reports add column updated_at timestamptz;
alter table public.sales_reports add column synced_at  timestamptz not null default now();

-- Switch row identity to ASIN (the SP-API sales report aggregates by ASIN, not
-- by seller SKU). sku stays as nullable metadata for future cross-mapping.
alter table public.sales_reports
  drop constraint sales_reports_seller_id_marketplace_id_report_date_sku_key;
alter table public.sales_reports alter column asin set not null;
alter table public.sales_reports
  add constraint sales_reports_unique_key
  unique (seller_id, marketplace_id, report_date, asin);

-- ── sync_logs ─────────────────────────────────────────────────────────────
alter table public.sync_logs add column job_run_id uuid;
create index sync_logs_job_run_id_idx on public.sync_logs(job_run_id);
