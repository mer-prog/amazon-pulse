================================================================================
<a id="amazon-pulse"></a>
## amazon-pulse

**Category:** H. Amazon SP-API
**Summary:** Multi-region Amazon SP-API Sandbox data aggregation pipeline with Edge Runtime dashboard
**Source file:** `PORTFOLIO_SPEC_EN.md`

================================================================================

# AmazonPulse — Multi-Region Amazon SP-API Sandbox Pipeline & Dashboard

> **What:** A pipeline system that aggregates data from Amazon SP-API (Selling Partner API) Sandbox across multiple sellers and marketplaces in parallel, visualized through an Edge Runtime dashboard with full multi-region support
> **Who:** Multi-region Amazon sellers, D2C brands evaluating SP-API integration, operations teams requiring centralized EC data aggregation
> **Tech:** TypeScript (strict + noUncheckedIndexedAccess) · Next.js 15 App Router (React 19) · Cloudflare Pages + Workers (Edge Runtime) · Supabase · Vitest · @cloudflare/next-on-pages · AES-256-GCM encryption · LWA OAuth · Token Bucket rate limiter · zod schema validation

**Source Code:** [github.com/mer-prog/amazon-pulse](https://github.com/mer-prog/amazon-pulse)
**Live Demo:** [amazon-pulse.pages.dev](https://amazon-pulse.pages.dev) (Sandbox-only mode)

---

## Skills Demonstrated

| Skill | Implementation |
|-------|---------------|
| Amazon SP-API Integration | LWA (Login with Amazon) OAuth 2.0 flow with refresh_token encrypted via AES-256-GCM. Type-safe ingestion of Orders / FBA Inventory / Sales / Catalog Items endpoints using zod schemas strictly aligned to the official Swagger model |
| Multi-Region Routing | Automatic SP-API endpoint resolution across NA / EU / FE regions based on marketplace_id. Each region maintains an independent Token Bucket rate limiter so cross-region rate limits never interfere |
| Token Bucket Rate Limiter | Bucket key designed as `<operation>:<region>` for full per-operation × per-region isolation. Fixed-rate transparent throttling combined with dynamic drain on 429 responses. Drain overlap takes the longer window; refill is calculated from drain-end |
| TypeScript Type Safety | strict + noUncheckedIndexedAccess across all packages. Array access becomes `T \| undefined`, dereferenced only after zod parse or explicit undefined check. SP-API responses use Swagger-conformant zod schemas with `.passthrough()` for forward compatibility with Amazon-side field additions |
| Edge Runtime SSR (Next 15 + React 19) | Next.js 15 App Router deployed to Cloudflare Pages via the `@cloudflare/next-on-pages` adapter. Server Components run on Edge Runtime; the Next 15 async params API is used so the `sellerId` dynamic segment is received as `Promise<{}>` and awaited. Combined with React 19 Server Component improvements for minimal initial render latency |
| Cloudflare Workers Cron | The `scheduled()` handler manages 4 independent cron schedules (orders/inventory every 6 hours, sales daily, products weekly). The pipeline workspace is reused via direct import |
| TDD with Vitest | 99 tests passing (pipeline 55 + frontend 24 + worker 20). Integration test patterns use a FakeSupabase mock; SANDBOX_ENDPOINTS URL is fixed in tests for deterministic execution |
| Encryption & Key Rotation | AES-256-GCM + base64 for credential encryption. Stored as `v1:<iv>:<tag>:<ct>` with explicit key version prefix for forward-compatible key rotation |
| Sync Job Tracking | `sync_logs` records per-marketplace rows + `job_run_id` (uuid) so partial failures are visible. `upsert with onConflict` pattern handles the SP-API time-boundary duplicate-fetch case idempotently |
| Multi-tenancy + RLS | Supabase Row Level Security plus a `sellers_public` view (security_invoker) cleanly separates seller data. Sandbox demo uses an `is_demo` flag to isolate demo records from production |

---

## Tech Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Language | TypeScript | ^5.x (strict + noUncheckedIndexedAccess) | Type-safe development |
| Frontend Framework | Next.js | ^15.x (App Router, async params, ships React 19) | Server Components, file-based routing |
| UI Library | React | ^19.x | Server Components, async API |
| Edge Runtime Adapter | @cloudflare/next-on-pages | ^1.13.x | Adapter to run Next.js on Cloudflare Pages (future migration to OpenNext under consideration) |
| Database | Supabase (PostgreSQL) | Free Plan | RLS + sellers_public view (security_invoker) |
| Edge Functions | Cloudflare Workers | Free Plan | scheduled() with 4 cron handlers |
| Hosting | Cloudflare Pages | Free Plan | Edge SSR + automatic CI/CD |
| API | Amazon SP-API | Latest (Sandbox) | Orders / FBA Inventory / Sales / Catalog Items |
| Auth | LWA (Login with Amazon) | OAuth 2.0 | refresh_token-based authentication |
| HTTP Client | axios + axios-retry | latest | Automatic retry + custom interceptors |
| Schema Validation | zod | latest (`.passthrough()` enabled) | Strict typing of SP-API responses |
| Encryption | Node.js crypto (AES-256-GCM) | built-in | Credential encryption with key rotation |
| Test Runner | Vitest | latest | 99 tests, FakeSupabase mock |
| Build Tool | npm workspaces | npm 10+ | Monorepo management |
| CI/CD | GitHub Actions | — | Tests + Supabase keepalive (every 3 days) |
| Runtime | Node.js | 20+ (Edge uses V8 isolate) | Local dev + Workers Edge |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                     Cloudflare Pages (Edge Runtime)                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Next.js 15 App Router Dashboard (React 19)        │  │
│  │  ┌──────────────────┐    ┌──────────────────────────────┐   │  │
│  │  │ /                │    │ /sellers/[sellerId]          │   │  │
│  │  │ (Sellers list)   │    │ (Seller detail + sync logs)  │   │  │
│  │  └────────┬─────────┘    └──────────────┬───────────────┘   │  │
│  │           │ Server Component fetch       │                   │  │
│  │           └──────────┬───────────────────┘                   │  │
│  │                      │                                       │  │
│  │  Sandbox Demo Banner: "Connected to SP-API Sandbox endpoint" │  │
│  └──────────────────────┼───────────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────────┘
                         │ supabase-js (Edge compatible)
                         ▼
              ┌──────────────────────┐
              │  Supabase            │◄────────────────────┐
              │  (PostgreSQL + RLS)  │                     │
              │                      │                     │
              │  - sellers           │                     │
              │  - seller_marketplaces│                    │
              │  - orders            │                     │
              │  - order_items       │                     │
              │  - inventory         │                     │
              │  - sales_reports     │                     │
              │  - products          │                     │
              │  - sync_logs         │                     │
              │  - sellers_public    │                     │
              │    (view, sec_inv)   │                     │
              └──────────▲───────────┘                     │
                         │ upsert with onConflict          │
                         │                                 │
              ┌──────────┴────────────────────────┐        │
              │  Cloudflare Workers (scheduled)   │        │
              │                                   │        │
              │  ┌─────────────────────────────┐  │        │
              │  │ orders sync   (every 6h)     │  │        │
              │  │ inventory sync(every 6h)     │  │        │
              │  │ sales sync    (daily)        │  │        │
              │  │ products sync (weekly)       │  │        │
              │  └─────────────┬───────────────┘  │        │
              │                │ runMarketplaceBatch       │
              └────────────────┼──────────────────┘        │
                               │                           │
                ┌──────────────▼─────────────────┐         │
                │  packages/pipeline (workspace) │         │
                │                                │         │
                │  ┌──────────────────────────┐  │         │
                │  │ SpApiClient              │  │         │
                │  │ - LWA OAuth              │  │         │
                │  │ - axios + retry          │  │         │
                │  │ - Token Bucket           │  │         │
                │  │   (op×region keyed)      │  │         │
                │  │ - region routing         │  │         │
                │  └────────┬─────────────────┘  │         │
                │           │ HTTPS               │         │
                └───────────┼────────────────────┘         │
                            │                              │
                ┌───────────▼─────────────────┐            │
                │  Amazon SP-API (Sandbox)    │            │
                │                             │            │
                │  - sandbox.eu (EU)          │            │
                │  - sandbox.na (NA)          │            │
                │  - sandbox.fe (FE)          │            │
                └─────────────────────────────┘            │
                                                           │
              ┌──────────────────────────────────┐         │
              │  GitHub Actions (every 3 days)   │         │
              │  Supabase keepalive ───────────────────────┘
              │  (Free plan auto-pause prevention)
              └──────────────────────────────────┘
```

---

## Key Features

### 1. SP-API LWA OAuth Flow (`packages/pipeline/src/lib/lwa-auth.ts`)
Implements the LWA (Login with Amazon) OAuth 2.0 refresh_token flow. Acquires access_token via `grant_type=refresh_token` and reuses it from in-memory cache while valid. Auto-refreshes on token expiration. The LWA endpoint (`https://api.amazon.com/auth/o2/token`) is independent from the SP-API endpoint, and this distinction is abstracted internally.

### 2. AES-256-GCM Encryption (`packages/pipeline/src/lib/encryption.ts`)
Encrypts credentials (refresh_token, client_secret, etc.) with AES-256-GCM. Stored as `v1:<iv_base64>:<tag_base64>:<ct_base64>` with the key version as a prefix to support future key rotation. The 32-byte master key is held in `ENCRYPTION_KEY` env, and IV is randomly generated per encryption.

### 3. SpApiClient (`packages/pipeline/src/lib/sp-api-client.ts`)
A unified client class for SP-API HTTPS requests. Combines axios + axios-retry for 5xx + 429 auto-retry, the Token Bucket rate limiter for transparent throttling, and region routing for automatic endpoint selection by marketplace_id. The `__spApiOperation` symbol attaches a request-level operation identifier without omission, guaranteeing accurate bucket key calculation.

### 4. Token Bucket Rate Limiter (`packages/pipeline/src/lib/token-bucket.ts` + `rate-limits.ts`)
SP-API enforces independent rate limits per operation (e.g., getOrders and getInventorySummaries each have their own bucket). The bucket key is `<operation>:<region>` for full operation × region isolation. The base mode is fixed-rate consumption, and on 429 responses the `x-amzn-RateLimit-Limit` header drives a dynamic drain. When drain windows overlap, the longer one wins; refill is calculated from drain-end.

### 5. Multi-Region Endpoint Routing (`packages/pipeline/src/lib/sp-api-endpoints.ts`)
Resolves the SP-API endpoint automatically from marketplace_id (e.g., `A1F83G8C2ARO7P` = UK = EU region). Uses a `SANDBOX_ENDPOINTS` map; unknown marketplace_ids **throw explicitly** (no silent fallback — a structural guarantee of the Sandbox-only constraint). Supports NA / EU / FE regions, and Sandbox endpoint URLs are fixed at the test level for deterministic results.

### 6. Four Sync Workers (`packages/pipeline/src/workers/`)
Four independent workers cover the data set required for Amazon EC operations:
- **orders sync**: Fetches orders for the past N hours via getOrders, upsert with onConflict
- **inventory sync**: Fetches FBA inventory via getInventorySummaries
- **sales-reports sync**: Daily report rows written to `sales_reports` (per seller / marketplace / report_date / sku)
- **products sync**: Updates product master via searchCatalogItems

All workers share `runMarketplaceBatch` (in `packages/pipeline/src/lib/sync-helpers.ts`), processing multiple marketplaces concurrently. `sync_logs` records per-marketplace rows + `job_run_id (uuid)` so partial failures are traceable. On failure, a synthetic failed row is inserted into sync_logs.

### 7. Sync Job Tracking (`sync_logs` table)
Each batch run writes one `sync_logs` row per (seller, marketplace, job_type) — sharing a single `job_run_id` across the rows of one orchestrator run so partial failures are traceable. `status` is one of `started` / `succeeded` / `failed` / `partial`; `records_fetched`, `records_upserted`, `error_code`, and `error_message` give full execution visibility. The data tables themselves track `last_update_date` (Amazon-side) separately from `fetched_at` (pipeline-side) so a stalled sync is distinguishable from a quiet day on Amazon.

### 8. Cloudflare Workers Cron Schedules (`packages/cloudflare-worker/src/index.ts`)
The `scheduled()` handler manages 4 cron schedules:

| Worker | Cron | Frequency |
|---|---|---|
| orders sync | `0 */6 * * *` | Every 6 hours, on the hour |
| inventory sync | `15 */6 * * *` | Every 6 hours, offset +15 min (spreads load away from orders) |
| sales-reports sync | `0 0 * * *` | Daily 00:00 UTC |
| products sync | `0 0 * * 0` | Weekly, Sunday 00:00 UTC |

Cloudflare Workers allows up to 5 cron schedules per Worker, and we keep it at 4 to leave headroom. The `packages/pipeline` is imported and reused directly. Node compatibility is enabled via the `nodejs_compat` flag.

### 9. Edge Runtime Dashboard (`packages/frontend/`)
A two-page Next.js 15 App Router setup:
- `/`: Sellers list with latest sync_logs summary, pinned Sandbox demo bar
- `/sellers/[sellerId]`: Seller detail with marketplace-level sync status and recent orders / inventory snapshot

Server Components fetch directly from Supabase and run on Edge Runtime (`export const runtime = 'edge'`). The Next 15 async params API is honored (`params: Promise<{ sellerId: string }>` received and unwrapped via `await params`). The `sellers_public` view (security_invoker) exposes only demo sellers. Combined with React 19 Server Component improvements for minimal initial render latency.

### 10. Sandbox Demo Banner
A persistent top banner reading: **"Sandbox Demo — Connected to SP-API Sandbox endpoint. Production credentials require a separate engagement."**
This makes the Sandbox-only constraint explicit while doubling as a bridge message toward production engagements — an Upwork-friendly framing.

### 11. Supabase Keepalive (`.github/workflows/keepalive.yml`)
Supabase Free Plan auto-pauses after 7 days of inactivity. A GitHub Actions workflow issues a `SELECT id FROM sellers LIMIT 1` request via PostgREST every 3 days to prevent auto-pause — keeping the demo always-on at $0/month.

---

## Database Schema

```
┌────────────────────────────────────────────────────┐
│                     sellers                         │
├────────────────────────────────────────────────────┤
│ id                       UUID PK                    │
│ owner_user_id            UUID  → auth.users         │
│ display_name             TEXT                       │
│ selling_partner_id       TEXT  UNIQUE               │
│ region                   TEXT  CHECK in (na/eu/fe)  │
│ refresh_token_encrypted  TEXT  ← AES-256-GCM        │
│ encryption_key_version   SMALLINT (1, 2, …)         │
│ is_active                BOOLEAN                    │
│ is_demo                  BOOLEAN  (migration 0003)  │
│ created_at, updated_at   TIMESTAMPTZ                │
└─────────┬──────────────────────────────────────────┘
          │ 1:N
          ▼
┌─────────────────────────────────────┐    ┌───────────────────────────────────┐
│      seller_marketplaces            │    │           sellers_public          │
├─────────────────────────────────────┤    │     (view, security_invoker)      │
│ id                UUID PK           │    ├───────────────────────────────────┤
│ seller_id         UUID FK           │    │ id, display_name,                 │
│ marketplace_id    TEXT (Amazon ID)  │    │ selling_partner_id, region,       │
│ country_code      CHAR(2)           │    │ is_active, is_demo,               │
│ default_currency  CHAR(3)           │    │ created_at, updated_at            │
│ is_enabled        BOOLEAN           │    │ FROM sellers WHERE is_demo = TRUE │
│ UNIQUE(seller_id, marketplace_id)   │    │ → anon-readable; refresh_token_*  │
└─────────────────────────────────────┘    │   columns are not exposed         │
                                           └───────────────────────────────────┘

┌────────────────────────────┐  ┌────────────────────────────┐  ┌────────────────────────────┐
│          orders            │  │         inventory          │  │          products          │
├────────────────────────────┤  ├────────────────────────────┤  ├────────────────────────────┤
│ id, seller_id, marketplace │  │ id, seller_id, marketplace │  │ id, seller_id, marketplace │
│ amazon_order_id            │  │ sku, asin                  │  │ sku, asin, title, brand    │
│ purchase_date              │  │ fulfillable_quantity       │  │ list_price, currency       │
│ last_update_date           │  │ inbound_working_quantity   │  │ image_url                  │
│ order_status               │  │ inbound_shipped_quantity   │  │ status                     │
│ fulfillment_channel        │  │ inbound_receiving_quantity │  │ raw (JSONB)                │
│ order_total_amount/curr    │  │ reserved_quantity          │  │ fetched_at                 │
│ items_shipped/unshipped    │  │ unfulfillable_quantity     │  │ created_at, updated_at     │
│ buyer_email, ship_country  │  │ total_quantity             │  │ UNIQUE(seller_id,          │
│ is_premium / is_business   │  │ raw (JSONB)                │  │        marketplace_id, sku)│
│ raw (JSONB)                │  │ fetched_at                 │  └────────────────────────────┘
│ fetched_at                 │  │ created_at, updated_at     │
│ created_at, updated_at     │  │ UNIQUE(seller_id,          │  ┌────────────────────────────┐
│ UNIQUE(marketplace_id,     │  │        marketplace_id, sku)│  │        order_items         │
│        amazon_order_id)    │  └────────────────────────────┘  ├────────────────────────────┤
└────────────────────────────┘                                  │ id, order_id (FK), seller  │
                                                                │ order_item_id (Amazon)     │
┌────────────────────────────┐  ┌─────────────────────────────┐ │ sku, asin, title           │
│       sales_reports        │  │          sync_logs          │ │ quantity_ordered/shipped   │
├────────────────────────────┤  ├─────────────────────────────┤ │ item_price_amount/curr     │
│ id, seller_id, marketplace │  │ id, seller_id, marketplace  │ │ item_tax_amount            │
│ report_date  DATE          │  │ job_run_id (UUID)           │ │ shipping_price_amount      │
│ sku, asin                  │  │ job_type CHECK ∈            │ │ promotion_discount         │
│ units_ordered, _refunded   │  │   (orders, inventory,       │ │ raw (JSONB)                │
│ ordered_product_sales_*    │  │    sales_reports, products) │ │ UNIQUE(order_id,           │
│ sessions, page_views       │  │ status CHECK ∈              │ │        order_item_id)      │
│ buy_box_percentage         │  │   (started, succeeded,      │ └────────────────────────────┘
│ raw (JSONB)                │  │    failed, partial)         │
│ UNIQUE(seller_id,          │  │ started_at, finished_at     │
│        marketplace_id,     │  │ records_fetched / upserted  │
│        report_date, sku)   │  │ error_code, error_message   │
└────────────────────────────┘  │ payload (JSONB)             │
                                └─────────────────────────────┘

Migrations:
  0001_initial_schema.sql       — base schema + RLS (owner_user_id-scoped)
  0002_phase2_sync_columns.sql  — sync_logs.job_run_id + worker hooks
  0003_phase5_demo_access.sql   — is_demo flag + sellers_public view + anon-read RLS
  0004_phase5_anon_grant.sql    — table-level GRANT SELECT to anon (RLS still gates rows)

RLS: every table has RLS enabled. service_role bypasses RLS (used by the cron pipeline).
     authenticated reads are scoped to sellers.owner_user_id = auth.uid().
     anon reads are scoped to is_demo = true (added in 0003).
Upsert pattern: ON CONFLICT (<natural_key>) DO UPDATE; updated_at maintained by trigger.
```

---

## Screen Specifications

### Sellers List (`/`)
- Sandbox Demo banner pinned at the top (amber background) explaining the Sandbox-only stance and leaving a bridge to a paid production engagement.
- Seller card grid (one card per demo seller, fetched via the `sellers_public` view).
- Each card: display name, masked selling-partner ID, region, marketplace flag chips, recent-runs / succeeded / failed counts, and the latest run summary with a `details →` link.

### Seller Detail (`/sellers/[sellerId]`)
- Header: display name, masked selling-partner ID, region, active/inactive badge.
- "Marketplaces · latest sync per job" table — for each marketplace the seller has enabled, the most recent log per `job_type` (orders / inventory / sales_reports / products) is rendered with a status badge, relative time, row counts, and duration.
- "Recent orchestrator runs" — the last 5 runs grouped by `job_run_id`, each listing the per-job rows (badge, job, marketplace, rows, duration, optional error code).

---

## API Endpoints

| Method | Path | Runtime | Auth | Description |
|--------|------|---------|------|-------------|
| GET | `/` | Edge | Public (demo) | Sellers list page (Server Component fetch) |
| GET | `/sellers/[sellerId]` | Edge | Public (demo) | Seller detail page (Server Component fetch) |
| Cron | `0 */6 * * *` | Workers | Internal | Triggers orders sync |
| Cron | `15 */6 * * *` | Workers | Internal | Triggers inventory sync (offset +15 min) |
| Cron | `0 0 * * *` | Workers | Internal | Triggers sales-reports sync (daily) |
| Cron | `0 0 * * 0` | Workers | Internal | Triggers products sync (weekly, Sunday) |

> The project is Server Components-centric, so API Routes are minimized. Data retrieval happens via direct Supabase fetches gated by RLS.

---

## Project Structure

**Total scale:** 5,907 lines of TypeScript / TSX (excluding node_modules / .next / .vercel; tests included)

| Package | LOC | Contents |
|---------|-----|----------|
| `packages/pipeline/` | **4,108 lines** | SP-API client / encryption / token-bucket / rate-limits / region routing / 4 sync workers / zod schemas / 55 tests |
| `packages/frontend/` | **1,118 lines** | Next.js 15 App Router / Edge Runtime pages / Supabase queries / components / 24 tests |
| `packages/cloudflare-worker/` | **681 lines** | scheduled() handler / 4 cron handlers / pipeline workspace reuse / 20 tests |
| **Total** | **5,907 lines** | |

```
amazon-pulse/                              monorepo (npm workspaces)
├── packages/
│   ├── pipeline/                          4,108 LOC
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── encryption.ts            AES-256-GCM encryption
│   │   │   │   ├── lwa-auth.ts              LWA OAuth refresh flow
│   │   │   │   ├── sp-api-client.ts         SP-API HTTP client
│   │   │   │   ├── supabase-client.ts       Supabase connection management
│   │   │   │   ├── token-bucket.ts          Token Bucket rate limiter
│   │   │   │   ├── rate-limits.ts           operation-level rate config
│   │   │   │   ├── sp-api-endpoints.ts      region routing
│   │   │   │   └── sync-helpers.ts          runMarketplaceBatch + sync_logs writer
│   │   │   ├── schemas/                     zod schemas (Swagger-aligned)
│   │   │   └── workers/
│   │   │       ├── sync-orders.ts           orders sync worker
│   │   │       ├── sync-inventory.ts        inventory sync worker
│   │   │       ├── sync-sales-reports.ts    sales-reports sync worker
│   │   │       └── sync-products.ts         products sync worker
│   │   └── tests/                           55 tests (FakeSupabase + URL fix)
│   │
│   ├── frontend/                          1,118 LOC
│   │   ├── app/
│   │   │   ├── page.tsx                   Sellers list (Edge Runtime)
│   │   │   ├── sellers/
│   │   │   │   └── [sellerId]/
│   │   │   │       └── page.tsx           Seller detail (Edge Runtime, async params)
│   │   │   └── layout.tsx                 Sandbox Demo Banner placement
│   │   ├── components/                    SellerCard / SyncStatusBadge / etc.
│   │   ├── lib/                           queries / format helpers
│   │   └── tests/                         24 tests
│   │
│   └── cloudflare-worker/                 681 LOC
│       ├── src/
│       │   └── index.ts                   scheduled() + 4 cron handlers
│       ├── wrangler.toml                  Cron triggers + nodejs_compat
│       └── tests/                         20 tests
│
├── infrastructure/
│   └── supabase/
│       ├── migrations/
│       │   ├── 0001_initial_schema.sql      base schema + RLS
│       │   ├── 0002_phase2_sync_columns.sql sync_logs.job_run_id + indexes
│       │   ├── 0003_phase5_demo_access.sql  is_demo flag + sellers_public view
│       │   └── 0004_phase5_anon_grant.sql   table-level GRANT SELECT to anon
│       └── seed.sql                         synthetic demo dataset
│
├── .github/
│   └── workflows/
│       ├── ci.yml                         typecheck + tests on push/PR
│       └── keepalive.yml                  Supabase REST ping every 3 days
│
├── package.json                           workspaces definition
├── tsconfig.json                          strict + noUncheckedIndexedAccess
└── README.md                              Upwork-focused version
```

---

## Setup

### Prerequisites

- Node.js 20+ & npm 10+
- Cloudflare account (Free Plan)
- Supabase account (Free Plan)
- Amazon SP-API Sandbox app registered (Sandbox endpoint only — no Production credentials required)

### Steps

```bash
# Clone the repository
git clone https://github.com/mer-prog/amazon-pulse.git
cd amazon-pulse

# Install dependencies
npm install

# Apply Supabase migrations (in order)
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0002_phase2_sync_columns.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0003_phase5_demo_access.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0004_phase5_anon_grant.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/seed.sql

# Encrypt your Sandbox app credentials and register them in Supabase
# (See README for details)

# Deploy Cloudflare Pages
npm run build:cf --workspace=packages/frontend
# → Deploy packages/frontend/.vercel/output/static/ to Cloudflare Pages

# Deploy Cloudflare Workers
cd packages/cloudflare-worker
npx wrangler deploy
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase Project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (Workers) | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Same URL (frontend Edge Runtime) | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (frontend) | Yes |
| `ENCRYPTION_KEY` | 32-byte AES-256-GCM master key (base64) | Yes |
| `SP_API_CLIENT_ID` | LWA app client ID (used by SP-API) | Yes |
| `SP_API_CLIENT_SECRET` | LWA app client secret (used by SP-API) | Yes |

### Cloudflare Pages Settings

| Item | Value |
|------|-------|
| Framework preset | Next.js |
| Build command | `npm run build:cf --workspace=packages/frontend` |
| Build output directory | `packages/frontend/.vercel/output/static` |
| Compatibility flags | `nodejs_compat` (Production + Preview) |

---

## Security Design

| Control | Implementation |
|---------|---------------|
| Credential Encryption | AES-256-GCM (`v1:<iv>:<tag>:<ct>`) for refresh_token storage with key rotation support |
| LWA OAuth | Dynamic access token retrieval via refresh_token flow; long-lived credentials only stored encrypted |
| Multi-tenant Isolation | All queries are filtered by seller_id; RLS + sellers_public view (security_invoker) separates demo from production |
| Sandbox-only Mode | The SANDBOX_ENDPOINTS map fixes endpoint URLs and structurally prevents access to Production endpoints |
| Throw on Unknown marketplace_id | Region routing throws explicitly on unknown marketplace_ids (no silent fallback) |
| Edge Runtime + nodejs_compat | Code runs in V8 isolates, minimizing attack surface; Node compatibility is opt-in via flag |
| Token Bucket Throttling | The rate limiter prevents 429 events before they happen, avoiding SP-API ToS violations |
| GitHub Actions Secrets | Secrets are managed via GitHub Secrets and never leak into logs |

---

## Design Decision Rationale

| Decision | Rationale |
|----------|----------|
| **Sandbox-only "halt-before-spend" implementation** | Acquiring Production credentials requires KYB and similar overhead, which is excessive for portfolio purposes. Sandbox is fully sufficient. The Sandbox banner copy doubles as a bridge to a production engagement |
| **Monorepo (npm workspaces)** | pipeline / frontend / cloudflare-worker share zod schemas and type definitions. This eliminates duplication and makes change tracking straightforward |
| **Token Bucket scoped to operation × region** | SP-API rate limits are independent per operation × region, so the bucket key matches that granularity to minimize the chance of rate limit violations |
| **Drain-overlap takes the longer window; refill from drain-end** | Keeps bucket state consistent when multiple 429 events occur in a short window. Taking the shorter window risks early drain release and re-hit |
| **sync_logs has N rows per marketplace + job_run_id** | Partial failures within a batch become visible per marketplace. A single-row aggregate would obscure which marketplace failed |
| **upsert with onConflict pattern** | Addresses the SP-API time-boundary problem (the same record may be returned across multiple batches). `ON CONFLICT DO UPDATE SET synced_at = NOW()` ensures idempotency |
| **updated_at vs synced_at separation** | Tracks Amazon-side updates and pipeline-side syncs independently, making it possible to isolate "Amazon stopped updating" from "the pipeline stopped running" |
| **Throw on unknown marketplace_id** | Silent fallbacks lead to silent mis-routing. An explicit throw is a structural guarantee of the Sandbox-only invariant |
| **@cloudflare/next-on-pages adoption** | Keeps the entire stack in Cloudflare (Workers + Pages) instead of migrating to Vercel. Natural integration with Workers Cron, retains Free Plan economics, and Edge Runtime latency is part of the Upwork pitch |
| **TypeScript strict + noUncheckedIndexedAccess** | Array access becomes `T \| undefined`, preventing undefined-derived crashes at the type level instead of at runtime |
| **Next.js 15 + React 19 adoption** | `@cloudflare/next-on-pages` peer dep requires `next >= 14.3.0`. Since Next.js 14.x stable ended at 14.2, we bumped to the latest stable Next 15 (and React 19 in tandem). This gains async params API, fetch cache improvements, and RSC streaming, while strengthening Upwork portfolio appeal with a modern stack |
| **`@cloudflare/next-on-pages` adoption (with future OpenNext migration in mind)** | Cloudflare is currently shifting its recommendation toward OpenNext. We use the still-stable next-on-pages today and plan a future-Wave migration to OpenNext. The adapter layer is encapsulated to minimize switching cost |
| **zod `.passthrough()` adoption** | If Amazon adds new fields to SP-API responses, strict parsers don't fail. Forward compatibility becomes a structural property |
| **Supabase keepalive via GitHub Actions** | Avoids the Supabase Free Plan's 7-day auto-pause at $0/month — no Supabase Pro ($25/mo) needed |
| **4 Cloudflare Workers Cron schedules** | Stays well within the Free Plan's 5-cron-per-worker limit, leaving room for future additions |

---

## Operating Cost

| Service | Plan | Monthly |
|---------|------|---------|
| Cloudflare Pages | Free Plan (500 builds/mo, unlimited bandwidth) | $0 |
| Cloudflare Workers | Free Plan (100k requests/day, 5 cron/worker) | $0 |
| Supabase | Free Plan (500MB DB + GitHub Actions keepalive) | $0 |
| GitHub Actions | Free tier (2000 min/mo) | $0 |
| Amazon SP-API Sandbox | Free (Sandbox endpoints only) | $0 |
| LWA app | Free (Login with Amazon) | $0 |
| **Total** | | **$0** |

> A production engagement (working with real sellers) would require Supabase Pro ($25) and Cloudflare Workers Paid ($5). The Sandbox demo runs continuously at $0.

---

## Author

[@mer-prog](https://github.com/mer-prog)
