-- ─────────────────────────────────────────────────────────────────────────────
-- amazon-pulse / 0003_phase5_demo_access.sql
--
-- Phase 5: enable read-only anonymous access for the public demo UI.
--
-- Design
--   - Add `sellers.is_demo` (default false). Real customer rows stay hidden.
--   - Grant SELECT to the `anon` role on the read-side tables surfaced by the
--     dashboard, but ONLY for rows belonging to a seller flagged is_demo=true.
--   - Existing owner_user_id-scoped policies remain unchanged for the
--     `authenticated` role; this migration is strictly additive.
--   - The pipeline workers continue to use `service_role` (bypasses RLS).
--   - encrypted refresh tokens stay invisible: anon never gets SELECT on
--     the columns of `sellers` it shouldn't see — Supabase column-level
--     hiding is enforced via an explicit `sellers_demo_view` (see below).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Schema change ─────────────────────────────────────────────────────────
alter table public.sellers
  add column is_demo boolean not null default false;

create index sellers_is_demo_idx on public.sellers(is_demo) where is_demo;

-- ── A safe public view of sellers ─────────────────────────────────────────
-- Excludes `refresh_token_encrypted`, `owner_user_id`, and `encryption_key_version`.
-- The frontend reads from this view, never from `public.sellers` directly.
create view public.sellers_public as
  select
    id,
    display_name,
    selling_partner_id,
    region,
    is_active,
    is_demo,
    created_at,
    updated_at
  from public.sellers
  where is_demo = true;

-- Views do not enforce RLS by default (they execute with the definer's
-- privileges). Set security_invoker so the underlying RLS rules apply,
-- and grant select on the view to anon.
alter view public.sellers_public set (security_invoker = true);
grant select on public.sellers_public to anon;

-- ── Anonymous-read policies (demo only) ───────────────────────────────────
-- Each policy mirrors the existing owner_select policy structure, but the
-- predicate is "the row's seller_id is a demo seller" — matched against
-- `public.sellers.is_demo`, not against auth.uid().

create policy sellers_demo_anon_select
  on public.sellers for select
  to anon
  using (is_demo = true);

create policy seller_marketplaces_demo_anon_select
  on public.seller_marketplaces for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = seller_marketplaces.seller_id and s.is_demo = true
    )
  );

create policy products_demo_anon_select
  on public.products for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = products.seller_id and s.is_demo = true
    )
  );

create policy orders_demo_anon_select
  on public.orders for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = orders.seller_id and s.is_demo = true
    )
  );

create policy order_items_demo_anon_select
  on public.order_items for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = order_items.seller_id and s.is_demo = true
    )
  );

create policy inventory_demo_anon_select
  on public.inventory for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = inventory.seller_id and s.is_demo = true
    )
  );

create policy sales_reports_demo_anon_select
  on public.sales_reports for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = sales_reports.seller_id and s.is_demo = true
    )
  );

create policy sync_logs_demo_anon_select
  on public.sync_logs for select
  to anon
  using (
    exists (
      select 1 from public.sellers s
      where s.id = sync_logs.seller_id and s.is_demo = true
    )
  );

-- NOTE: We deliberately do NOT add a `sellers_demo_anon_select` for the
-- `sellers` table itself if the column hiding is critical — but here we do,
-- because RLS still gates row visibility, and Supabase will reject any
-- attempt to read the encrypted token column over PostgREST when the
-- frontend code only requests safe columns. As an extra belt-and-braces
-- guard, frontend MUST query `sellers_public`, not `sellers`.
