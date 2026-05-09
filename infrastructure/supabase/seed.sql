-- ─────────────────────────────────────────────────────────────────────────────
-- amazon-pulse / seed.sql
--
-- Mock data so the project can be demoed by `git clone` + `supabase db reset`
-- without any live SP-API credentials.
--
-- All identifiers below are FICTIONAL. They mimic Amazon's id formats but do
-- not correspond to any real seller, ASIN, or order.
-- ─────────────────────────────────────────────────────────────────────────────

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

insert into public.seller_marketplaces (seller_id, marketplace_id, country_code, default_currency)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', 'DE', 'EUR'),
  ('11111111-1111-1111-1111-111111111111', 'A13V1IB3VIYZZH', 'FR', 'EUR'),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', 'GB', 'GBP');

insert into public.products
  (seller_id, marketplace_id, sku, asin, title, brand, list_price, currency, status)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'DEMO-SKU-DE-001', 'B0FAKE00001', 'Wireless Bluetooth Headphones (Demo)',
   'PulseAudio', 49.99, 'EUR', 'active'),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'DEMO-SKU-DE-002', 'B0FAKE00002', 'USB-C Fast Charger 65W (Demo)',
   'PulseAudio', 24.99, 'EUR', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'DEMO-SKU-UK-001', 'B0FAKE10001', 'Insulated Travel Mug 500ml (Demo)',
   'NorthernKettle', 14.50, 'GBP', 'active');

insert into public.inventory
  (seller_id, marketplace_id, sku, asin, fulfillable_quantity, total_quantity)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', 'DEMO-SKU-DE-001', 'B0FAKE00001', 124, 140),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', 'DEMO-SKU-DE-002', 'B0FAKE00002',   8,  20),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', 'DEMO-SKU-UK-001', 'B0FAKE10001',  62,  75);

insert into public.orders
  (id, seller_id, marketplace_id, amazon_order_id, purchase_date, order_status,
   fulfillment_channel, order_total_amount, order_total_currency,
   number_of_items_shipped, ship_country)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
   '11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   '026-1000001-1000001', '2026-05-07 09:14:00+00', 'Shipped',
   'AFN', 49.99, 'EUR', 1, 'DE'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
   '11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   '026-1000002-1000002', '2026-05-08 14:02:00+00', 'Unshipped',
   'AFN', 24.99, 'EUR', 0, 'DE'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
   '22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   '203-2000001-2000001', '2026-05-08 18:30:00+00', 'Shipped',
   'MFN', 29.00, 'GBP', 2, 'GB');

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
   '22222222-2222-2222-2222-222222222222',
   'DEMO-SKU-UK-001', 'B0FAKE10001', 'Insulated Travel Mug 500ml (Demo)',
   2, 2, 14.50, 'GBP');

insert into public.sales_reports
  (seller_id, marketplace_id, report_date, sku, asin,
   units_ordered, ordered_product_sales_amount, ordered_product_sales_currency,
   sessions, page_views)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', '2026-05-07',
   'DEMO-SKU-DE-001', 'B0FAKE00001', 1, 49.99, 'EUR', 42, 58),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9', '2026-05-08',
   'DEMO-SKU-DE-002', 'B0FAKE00002', 1, 24.99, 'EUR', 31, 44),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P', '2026-05-08',
   'DEMO-SKU-UK-001', 'B0FAKE10001', 2, 29.00, 'GBP', 27, 39);

insert into public.sync_logs
  (seller_id, marketplace_id, job_type, status, finished_at,
   records_fetched, records_upserted)
values
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'orders', 'succeeded', now() - interval '2 hours', 2, 2),
  ('11111111-1111-1111-1111-111111111111', 'A1PA6795UKMFR9',
   'inventory', 'succeeded', now() - interval '2 hours', 2, 2),
  ('22222222-2222-2222-2222-222222222222', 'A1F83G8C2ARO7P',
   'orders', 'succeeded', now() - interval '90 minutes', 1, 1);
