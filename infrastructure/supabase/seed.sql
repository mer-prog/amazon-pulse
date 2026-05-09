-- ─────────────────────────────────────────────────────────────────────────────
-- amazon-pulse / seed.sql
--
-- Mock data so the project can be demoed via `git clone` + applying
-- migrations 0001 + 0002, with no live SP-API credentials.
--
-- Schema state assumed (post-0002):
--   - synced_at  is pipeline-managed and defaults to now()
--   - updated_at is Amazon-side (LastUpdateDate / lastUpdatedTime), nullable
--   - sales_reports.asin is NOT NULL; uniqueness is per (..., report_date, asin)
--   - sync_logs.job_run_id ties together the rows of one orchestrator run
--
-- All identifiers below are FICTIONAL. They mimic Amazon's id formats but do
-- not correspond to any real seller, ASIN, or order.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── sellers ────────────────────────────────────────────────────────────────
insert into public.sellers (id, display_name, selling_partner_id, region, refresh_token_encrypted, is_active)
values
  ('11111111-1111-1111-1111-111111111111',
   'Demo Seller GmbH',
   'A1DEMOSELLER001',
   'eu',
   'enc:placeholder-not-a-real-token',
   true),
  ('22222222-2222-2222-2222-222222222222',
   'Sample UK Trader Ltd',
   'A1DEMOSELLER002',
   'eu',
   'enc:placeholder-not-a-real-token',
   true);

-- ── seller_marketplaces ────────────────────────────────────────────────────
insert into public.seller_marketplaces (seller_id, marketplace_id, country_code, default_currency)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', 'DE', 'EUR'),
  ('11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH', 'FR', 'EUR'),
  ('11111111-1111-1111-1111-111111111111', 'APJ6JRA9NG5V4',  'IT', 'EUR'),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', 'GB', 'GBP');

-- ── products ──────────────────────────────────────────────────────────────
insert into public.products
  (seller_id, marketplace_id, sku, asin, title, brand, list_price, currency, status,
   updated_at, synced_at)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'DEMO-SKU-DE-001', 'B0FAKE00001', 'Wireless Bluetooth Headphones (Demo)',
   'PulseAudio', 49.99, 'EUR', 'active', null, now()),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'DEMO-SKU-DE-002', 'B0FAKE00002', 'USB-C Fast Charger 65W (Demo)',
   'PulseAudio', 24.99, 'EUR', 'active', null, now()),
  ('11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH',
   'DEMO-SKU-FR-001', 'B0FAKE00001', 'Casque Bluetooth sans fil (Demo)',
   'PulseAudio', 52.00, 'EUR', 'active', null, now()),
  ('11111111-1111-1111-1111-111111111111', 'APJ6JRA9NG5V4',
   'DEMO-SKU-IT-001', 'B0FAKE00010', 'Tappetino mouse ergonomico (Demo)',
   'PulseAudio', 18.50, 'EUR', 'incomplete', null, now()),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'DEMO-SKU-UK-001', 'B0FAKE10001', 'Insulated Travel Mug 500ml (Demo)',
   'NorthernKettle', 14.50, 'GBP', 'active', null, now()),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'DEMO-SKU-UK-002', 'B0FAKE10002', 'Reusable Coffee Cup 350ml (Demo)',
   'NorthernKettle',  9.99, 'GBP', 'active', null, now());

-- ── inventory ─────────────────────────────────────────────────────────────
insert into public.inventory
  (seller_id, marketplace_id, sku, asin, fulfillable_quantity,
   inbound_working_quantity, inbound_shipped_quantity, inbound_receiving_quantity,
   reserved_quantity, unfulfillable_quantity, total_quantity,
   updated_at, synced_at)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', 'DEMO-SKU-DE-001', 'B0FAKE00001',
   124, 0, 16, 0, 4, 2, 146, '2026-05-08 03:00:00+00', now()),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', 'DEMO-SKU-DE-002', 'B0FAKE00002',
     8, 50, 0, 0, 2, 1,  61, '2026-05-08 03:00:00+00', now()),
  ('11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH', 'DEMO-SKU-FR-001', 'B0FAKE00001',
    47, 0, 0, 0, 3, 0,  50, '2026-05-08 03:00:00+00', now()),
  ('11111111-1111-1111-1111-111111111111', 'APJ6JRA9NG5V4',  'DEMO-SKU-IT-001', 'B0FAKE00010',
     0, 0, 30, 0, 0, 0,  30, '2026-05-08 03:00:00+00', now()),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', 'DEMO-SKU-UK-001', 'B0FAKE10001',
    62, 0, 0, 0, 5, 8,  75, '2026-05-08 03:00:00+00', now()),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', 'DEMO-SKU-UK-002', 'B0FAKE10002',
    33, 100, 0, 0, 0, 0, 133, '2026-05-08 03:00:00+00', now());

-- ── orders ────────────────────────────────────────────────────────────────
insert into public.orders
  (id, seller_id, marketplace_id, amazon_order_id, purchase_date,
   updated_at, order_status, fulfillment_channel,
   order_total_amount, order_total_currency,
   number_of_items_shipped, number_of_items_unshipped, ship_country,
   synced_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
   '11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   '026-1000001-1000001', '2026-05-07 09:14:00+00', '2026-05-07 18:00:00+00',
   'Shipped', 'AFN', 49.99, 'EUR', 1, 0, 'DE', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
   '11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   '026-1000002-1000002', '2026-05-08 14:02:00+00', '2026-05-08 14:02:00+00',
   'Unshipped', 'AFN', 24.99, 'EUR', 0, 1, 'DE', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
   '11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH',
   '028-3000001-3000001', '2026-05-08 11:30:00+00', '2026-05-08 16:45:00+00',
   'Shipped', 'AFN', 52.00, 'EUR', 1, 0, 'FR', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
   '22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   '203-2000001-2000001', '2026-05-08 18:30:00+00', '2026-05-08 19:00:00+00',
   'Shipped', 'MFN', 29.00, 'GBP', 2, 0, 'GB', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05',
   '22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   '203-2000002-2000002', '2026-05-09 07:12:00+00', '2026-05-09 07:12:00+00',
   'Pending', 'MFN', 9.99, 'GBP', 0, 1, 'GB', now());

-- ── order_items ───────────────────────────────────────────────────────────
insert into public.order_items
  (order_id, order_item_id, seller_id, sku, asin, title,
   quantity_ordered, quantity_shipped, item_price_amount, item_price_currency)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', '50000000001',
   '11111111-1111-1111-1111-111111111111',
   'DEMO-SKU-DE-001', 'B0FAKE00001', 'Wireless Bluetooth Headphones (Demo)',
   1, 1, 49.99, 'EUR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', '50000000002',
   '11111111-1111-1111-1111-111111111111',
   'DEMO-SKU-DE-002', 'B0FAKE00002', 'USB-C Fast Charger 65W (Demo)',
   1, 0, 24.99, 'EUR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', '50000000003',
   '11111111-1111-1111-1111-111111111111',
   'DEMO-SKU-FR-001', 'B0FAKE00001', 'Casque Bluetooth sans fil (Demo)',
   1, 1, 52.00, 'EUR'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', '50000000004',
   '22222222-2222-2222-2222-222222222222',
   'DEMO-SKU-UK-001', 'B0FAKE10001', 'Insulated Travel Mug 500ml (Demo)',
   2, 2, 14.50, 'GBP'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05', '50000000005',
   '22222222-2222-2222-2222-222222222222',
   'DEMO-SKU-UK-002', 'B0FAKE10002', 'Reusable Coffee Cup 350ml (Demo)',
   1, 0,  9.99, 'GBP');

-- ── sales_reports ─────────────────────────────────────────────────────────
insert into public.sales_reports
  (seller_id, marketplace_id, report_date, sku, asin,
   units_ordered, ordered_product_sales_amount, ordered_product_sales_currency,
   sessions, page_views, buy_box_percentage, synced_at)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', '2026-05-06',
   'DEMO-SKU-DE-001', 'B0FAKE00001', 3,  149.97, 'EUR', 124, 168, 92.4, now()),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', '2026-05-07',
   'DEMO-SKU-DE-001', 'B0FAKE00001', 1,   49.99, 'EUR',  42,  58, 89.1, now()),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', '2026-05-08',
   'DEMO-SKU-DE-002', 'B0FAKE00002', 1,   24.99, 'EUR',  31,  44, 76.5, now()),
  ('11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH', '2026-05-08',
   'DEMO-SKU-FR-001', 'B0FAKE00001', 1,   52.00, 'EUR',  18,  22, 81.0, now()),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', '2026-05-08',
   'DEMO-SKU-UK-001', 'B0FAKE10001', 2,   29.00, 'GBP',  27,  39, 95.2, now()),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', '2026-05-09',
   'DEMO-SKU-UK-002', 'B0FAKE10002', 1,    9.99, 'GBP',  14,  19, 88.6, now());

-- ── sync_logs ─────────────────────────────────────────────────────────────
-- Two orchestrator runs visible in history. Each run = N rows sharing job_run_id.
insert into public.sync_logs
  (seller_id, marketplace_id, job_run_id, job_type, status, started_at, finished_at,
   records_fetched, records_upserted)
values
  -- Run 1: seller 1, all 3 EU markets, all 4 job types succeeded
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'cccccccc-cccc-cccc-cccc-cccccccccc01', 'orders',        'succeeded',
   now() - interval '4 hours', now() - interval '4 hours' + interval '12 seconds', 2, 2),
  ('11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH',
   'cccccccc-cccc-cccc-cccc-cccccccccc01', 'orders',        'succeeded',
   now() - interval '4 hours', now() - interval '4 hours' + interval '8 seconds',  1, 1),
  ('11111111-1111-1111-1111-111111111111', 'APJ6JRA9NG5V4',
   'cccccccc-cccc-cccc-cccc-cccccccccc01', 'orders',        'succeeded',
   now() - interval '4 hours', now() - interval '4 hours' + interval '5 seconds',  0, 0),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'cccccccc-cccc-cccc-cccc-cccccccccc01', 'inventory',     'succeeded',
   now() - interval '4 hours', now() - interval '4 hours' + interval '6 seconds',  2, 2),
  -- Run 2: seller 2, UK only, 1 partial failure on sales_reports
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'cccccccc-cccc-cccc-cccc-cccccccccc02', 'orders',        'succeeded',
   now() - interval '90 minutes', now() - interval '90 minutes' + interval '7 seconds', 2, 2),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'cccccccc-cccc-cccc-cccc-cccccccccc02', 'inventory',     'succeeded',
   now() - interval '90 minutes', now() - interval '90 minutes' + interval '4 seconds', 2, 2),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'cccccccc-cccc-cccc-cccc-cccccccccc02', 'sales_reports', 'failed',
   now() - interval '90 minutes', now() - interval '90 minutes' + interval '12 seconds', 0, 0);

update public.sync_logs
   set error_code = 'report_timeout',
       error_message = 'report did not reach a terminal status within 60 polls'
 where job_run_id = 'cccccccc-cccc-cccc-cccc-cccccccccc02'
   and job_type = 'sales_reports';
