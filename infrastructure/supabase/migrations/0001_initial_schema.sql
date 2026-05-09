-- ─────────────────────────────────────────────────────────────────────────────
-- amazon-pulse / 0001_initial_schema.sql
--
-- Core schema for SP-API ingestion pipeline.
--   - sellers, seller_marketplaces, products, orders, order_items,
--     inventory, sales_reports, sync_logs
--   - Row Level Security enabled on every table from the start.
--   - Service role bypasses RLS by default (used by the pipeline workers);
--     authenticated users can only read rows belonging to their own seller_id.
--
-- Conventions
--   - All ids: UUID v4, generated server-side via gen_random_uuid().
--   - Money: numeric(14,4) with explicit currency code (ISO-4217).
--   - Timestamps: timestamptz, default now().
--   - Marketplace ids are Amazon-issued strings (e.g. A1F83G8C2ARO7P for UK).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- sellers
--   One row per Amazon seller account (a Selling Partner).
--   refresh_token is encrypted at the application layer before insert
--   (see packages/pipeline/src/lib/encryption.ts).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.sellers (
  id                       uuid primary key default gen_random_uuid(),
  owner_user_id            uuid references auth.users(id) on delete set null,
  display_name             text        not null,
  selling_partner_id       text        not null unique,
  region                   text        not null check (region in ('na', 'eu', 'fe')),
  refresh_token_encrypted  text        not null,
  encryption_key_version   smallint    not null default 1,
  is_active                boolean     not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index sellers_owner_user_id_idx on public.sellers(owner_user_id);
create index sellers_is_active_idx     on public.sellers(is_active) where is_active;

create trigger sellers_set_updated_at
before update on public.sellers
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- seller_marketplaces
--   Many-to-many: each seller can sell across multiple EU/UK marketplaces.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.seller_marketplaces (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.sellers(id) on delete cascade,
  marketplace_id  text not null,             -- e.g. A1F83G8C2ARO7P (UK)
  country_code    char(2) not null,          -- ISO-3166-1 alpha-2
  default_currency char(3) not null,         -- ISO-4217
  is_enabled      boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (seller_id, marketplace_id)
);

create index seller_marketplaces_seller_id_idx on public.seller_marketplaces(seller_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- products
--   SKU/ASIN catalog snapshot per seller+marketplace.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.sellers(id) on delete cascade,
  marketplace_id  text not null,
  sku             text not null,
  asin            text,
  title           text,
  brand           text,
  list_price      numeric(14,4),
  currency        char(3),
  image_url       text,
  status          text check (status in ('active','inactive','incomplete','suppressed')),
  raw             jsonb,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (seller_id, marketplace_id, sku)
);

create index products_asin_idx          on public.products(asin) where asin is not null;
create index products_seller_id_idx     on public.products(seller_id);
create index products_marketplace_id_idx on public.products(marketplace_id);

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- orders
--   One row per Amazon order. amazon_order_id is unique within a marketplace.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  seller_id             uuid not null references public.sellers(id) on delete cascade,
  marketplace_id        text not null,
  amazon_order_id       text not null,        -- e.g. 026-1234567-1234567
  purchase_date         timestamptz not null,
  last_update_date      timestamptz,
  order_status          text not null,        -- Pending / Unshipped / Shipped / Canceled / ...
  fulfillment_channel   text,                 -- AFN (FBA) / MFN
  sales_channel         text,
  order_total_amount    numeric(14,4),
  order_total_currency  char(3),
  number_of_items_shipped   integer,
  number_of_items_unshipped integer,
  buyer_email           text,
  ship_country          char(2),
  is_premium_order      boolean,
  is_business_order     boolean,
  raw                   jsonb,
  fetched_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (marketplace_id, amazon_order_id)
);

create index orders_seller_id_idx       on public.orders(seller_id);
create index orders_purchase_date_idx   on public.orders(purchase_date desc);
create index orders_status_idx          on public.orders(order_status);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- order_items
-- ─────────────────────────────────────────────────────────────────────────────

create table public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete cascade,
  order_item_id         text not null,        -- Amazon's OrderItemId
  seller_id             uuid not null references public.sellers(id) on delete cascade,
  sku                   text not null,
  asin                  text,
  title                 text,
  quantity_ordered      integer not null,
  quantity_shipped      integer,
  item_price_amount     numeric(14,4),
  item_price_currency   char(3),
  item_tax_amount       numeric(14,4),
  shipping_price_amount numeric(14,4),
  promotion_discount    numeric(14,4),
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  unique (order_id, order_item_id)
);

create index order_items_order_id_idx  on public.order_items(order_id);
create index order_items_seller_id_idx on public.order_items(seller_id);
create index order_items_sku_idx       on public.order_items(sku);

-- ─────────────────────────────────────────────────────────────────────────────
-- inventory
--   Current snapshot of inventory levels per SKU per marketplace.
--   We keep a single "latest" row per (seller, marketplace, sku); historical
--   movement is captured in sync_logs payloads if needed later.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.inventory (
  id                       uuid primary key default gen_random_uuid(),
  seller_id                uuid not null references public.sellers(id) on delete cascade,
  marketplace_id           text not null,
  sku                      text not null,
  asin                     text,
  fulfillable_quantity     integer not null default 0,
  inbound_working_quantity integer not null default 0,
  inbound_shipped_quantity integer not null default 0,
  inbound_receiving_quantity integer not null default 0,
  reserved_quantity        integer not null default 0,
  unfulfillable_quantity   integer not null default 0,
  total_quantity           integer not null default 0,
  raw                      jsonb,
  fetched_at               timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (seller_id, marketplace_id, sku)
);

create index inventory_seller_id_idx  on public.inventory(seller_id);
create index inventory_asin_idx       on public.inventory(asin) where asin is not null;
create index inventory_low_stock_idx  on public.inventory(fulfillable_quantity)
  where fulfillable_quantity < 10;

create trigger inventory_set_updated_at
before update on public.inventory
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- sales_reports
--   Aggregated daily sales report rows from SP-API Reports API.
--   One row per (seller, marketplace, report_date, sku).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.sales_reports (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.sellers(id) on delete cascade,
  marketplace_id  text not null,
  report_date     date not null,
  sku             text,
  asin            text,
  units_ordered   integer not null default 0,
  units_refunded  integer not null default 0,
  ordered_product_sales_amount   numeric(14,4) not null default 0,
  ordered_product_sales_currency char(3),
  sessions        integer,
  page_views      integer,
  buy_box_percentage numeric(6,3),
  raw             jsonb,
  created_at      timestamptz not null default now(),
  unique (seller_id, marketplace_id, report_date, sku)
);

create index sales_reports_seller_date_idx
  on public.sales_reports(seller_id, report_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_logs
--   Audit trail for every pipeline run. Captures success/failure, counts,
--   and SP-API error payloads for debugging.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.sync_logs (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid references public.sellers(id) on delete set null,
  marketplace_id  text,
  job_type        text not null check (job_type in (
                    'orders','inventory','sales_reports','products'
                  )),
  status          text not null check (status in (
                    'started','succeeded','failed','partial'
                  )),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  records_fetched integer,
  records_upserted integer,
  error_code      text,
  error_message   text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);

create index sync_logs_seller_started_idx
  on public.sync_logs(seller_id, started_at desc);
create index sync_logs_job_status_idx
  on public.sync_logs(job_type, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Strategy:
--   - Enable RLS on every table.
--   - service_role (used by pipeline workers) bypasses RLS automatically,
--     so no policies are needed for it.
--   - authenticated users can only read rows whose seller belongs to them
--     (sellers.owner_user_id = auth.uid()). No write access from clients.
--   - anon role gets no access.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sellers              enable row level security;
alter table public.seller_marketplaces  enable row level security;
alter table public.products             enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.inventory            enable row level security;
alter table public.sales_reports        enable row level security;
alter table public.sync_logs            enable row level security;

-- sellers: a user can read their own seller rows
create policy sellers_owner_select
  on public.sellers for select
  to authenticated
  using (owner_user_id = auth.uid());

-- helper: a row is "owned" if its seller_id resolves to a seller owned by auth.uid()
-- expressed inline per-table to keep policies independent of any custom function.

create policy seller_marketplaces_owner_select
  on public.seller_marketplaces for select
  to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = seller_marketplaces.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

create policy products_owner_select
  on public.products for select
  to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = products.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

create policy orders_owner_select
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = orders.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

create policy order_items_owner_select
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = order_items.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

create policy inventory_owner_select
  on public.inventory for select
  to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = inventory.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

create policy sales_reports_owner_select
  on public.sales_reports for select
  to authenticated
  using (
    exists (
      select 1 from public.sellers s
      where s.id = sales_reports.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

create policy sync_logs_owner_select
  on public.sync_logs for select
  to authenticated
  using (
    seller_id is not null
    and exists (
      select 1 from public.sellers s
      where s.id = sync_logs.seller_id
        and s.owner_user_id = auth.uid()
    )
  );

-- Revoke writes from authenticated/anon explicitly. The service_role bypasses RLS.
revoke insert, update, delete on public.sellers              from authenticated, anon;
revoke insert, update, delete on public.seller_marketplaces  from authenticated, anon;
revoke insert, update, delete on public.products             from authenticated, anon;
revoke insert, update, delete on public.orders               from authenticated, anon;
revoke insert, update, delete on public.order_items          from authenticated, anon;
revoke insert, update, delete on public.inventory            from authenticated, anon;
revoke insert, update, delete on public.sales_reports        from authenticated, anon;
revoke insert, update, delete on public.sync_logs            from authenticated, anon;
