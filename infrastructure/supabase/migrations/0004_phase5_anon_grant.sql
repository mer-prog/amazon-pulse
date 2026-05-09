-- ─────────────────────────────────────────────────────────────────────────────
-- amazon-pulse / 0004_phase5_anon_grant.sql
--
-- 0003 で anon 向け RLS policy は作成済みだが、対応する table-level の
-- GRANT SELECT 付与が漏れていた。本番 DB には Supabase SQL Editor で
-- 既に手動適用済みのため運用影響はないが、fresh DB に migration を
-- 流し直した際に dashboard が空になる事象を防ぐため、再現性確保として
-- 本ファイルを追加する。
-- ─────────────────────────────────────────────────────────────────────────────

grant select (id, display_name, selling_partner_id, region, is_active, is_demo, created_at, updated_at) on public.sellers to anon;
grant select on public.seller_marketplaces to anon;
grant select on public.products to anon;
grant select on public.orders to anon;
grant select on public.order_items to anon;
grant select on public.inventory to anon;
grant select on public.sales_reports to anon;
grant select on public.sync_logs to anon;
