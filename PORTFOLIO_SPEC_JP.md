================================================================================
<a id="amazon-pulse"></a>
## amazon-pulse

**カテゴリ:** H. Amazon SP-API系
**概要:** Amazon SP-API Sandbox を活用した Multi-region Seller データ集約 Pipeline + Edge Runtime ダッシュボード
**ソースファイル:** `PORTFOLIO_SPEC_JP.md`

================================================================================

# AmazonPulse — Multi-Region Amazon SP-API Sandbox Pipeline & Dashboard

> **何を:** Amazon SP-API (Selling Partner API) Sandbox から複数 Seller × 複数マーケットプレイスのデータを並列同期し、Edge Runtime ダッシュボードで可視化する Multi-region 対応 Pipeline システム
> **誰に:** Amazon EC を運営する Multi-region Seller、SP-API 統合を検討する D2C ブランド、ECデータ集約を必要とする運用チーム
> **技術:** TypeScript (strict + noUncheckedIndexedAccess) · Next.js 15 App Router (React 19) · Cloudflare Pages + Workers (Edge Runtime) · Supabase · Vitest · @cloudflare/next-on-pages · AES-256-GCM encryption · LWA OAuth · Token Bucket rate limiter · zod schema validation

**ソースコード:** [github.com/mer-prog/amazon-pulse](https://github.com/mer-prog/amazon-pulse)
**ライブデモ:** [amazon-pulse.pages.dev](https://amazon-pulse.pages.dev) (Sandbox-only mode)

---

## このプロジェクトで証明できるスキル

| スキル | 実装内容 |
|--------|----------|
| Amazon SP-API 統合 | LWA (Login with Amazon) OAuth 2.0 認証フロー、refresh_token を AES-256-GCM で暗号化保存。SP-API Orders / FBA Inventory / Sales / Catalog Items 4 種を Swagger model 厳密準拠の zod schema で型安全に取り込み |
| Multi-region ルーティング | NA / EU / FE 3 リージョンの SP-API endpoint を marketplace_id ベースで自動振り分け。Region 単位で独立した Token Bucket rate limiter を保持し、リージョン間で rate limit が干渉しない設計 |
| Token Bucket Rate Limiter | SP-API operation 単位 × region 単位の bucket key 設計。固定 rate での透過的 throttle + 429 hit 時の bucket drain で動的調整。drain overlap で長い方を採用、refill は drain-end 起点で計算 |
| TypeScript 型安全性 | strict + noUncheckedIndexedAccess を全 packages で有効化。配列アクセスは T \| undefined 化し、zod parse 後 or 明示 undefined check 後のみ参照。SP-API レスポンスは Swagger model 厳密準拠 + .passthrough() で Amazon 側追加 field 耐性 |
| Edge Runtime SSR (Next 15 + React 19) | Next.js 15 App Router を Cloudflare Pages に @cloudflare/next-on-pages adapter 経由でデプロイ。Server Components を Edge Runtime で実行、async params API で動的 route の sellerId を `Promise<{}>` 経由で受け取り、Supabase からのデータ取得を最小レイテンシで実現 |
| Cloudflare Workers Cron | scheduled() handler で 4 種の cron schedule(orders/inventory 6時間ごと、sales 日次、products 週次)を独立管理。Pipeline workspace を import で完全再利用 |
| TDD with Vitest | 99 tests passing(pipeline 55 + frontend 24 + worker 20)。FakeSupabase mock を使った integration test パターン、SANDBOX_ENDPOINTS の URL test 固定など、テスト容易性を確保した設計 |
| 暗号化と Key Rotation | AES-256-GCM + base64 で credentials を暗号化。`v1:<iv>:<tag>:<ct>` 形式で key version 付きの key rotation 対応設計 |
| Sync Job Tracking | sync_logs を marketplace 単位で N 行記録 + job_run_id (uuid) で部分失敗を可視化。upsert with onConflict pattern で SP-API 境界時刻の二重取得耐性 |
| Multi-tenancy + RLS | Supabase Row Level Security + sellers_public view (security_invoker) で seller 間データ分離。Sandbox demo では is_demo flag で本番データと分離 |

---

## 技術スタック

| カテゴリ | 技術 | バージョン | 用途 |
|----------|------|-----------|------|
| 言語 | TypeScript | ^5.x (strict + noUncheckedIndexedAccess) | 型安全な開発 |
| Frontend Framework | Next.js | ^15.x (App Router, async params, React 19 同梱) | Server Components, file-based routing |
| UI Library | React | ^19.x | Server Components, async API |
| Edge Runtime Adapter | @cloudflare/next-on-pages | ^1.13.x | Next.js を Cloudflare Pages で動作させる adapter(将来 OpenNext 移行検討) |
| Database | Supabase (PostgreSQL) | Free Plan | RLS + sellers_public view (security_invoker) |
| Edge Functions | Cloudflare Workers | Free Plan | scheduled() で 4 cron handler |
| Hosting | Cloudflare Pages | Free Plan | Edge SSR + 自動 CI/CD |
| API | Amazon SP-API | 最新版 (Sandbox) | Orders / FBA Inventory / Sales / Catalog Items |
| Auth | LWA (Login with Amazon) | OAuth 2.0 | refresh_token ベース認証 |
| HTTP Client | axios + axios-retry | latest | 自動 retry + custom interceptor |
| Schema Validation | zod | latest (.passthrough() 活用) | SP-API レスポンスの厳密型付け |
| Encryption | Node.js crypto (AES-256-GCM) | built-in | credentials 暗号化、key rotation 対応 |
| Test Runner | Vitest | latest | 99 tests, FakeSupabase mock |
| Build Tool | npm workspaces | npm 10+ | monorepo 管理 |
| CI/CD | GitHub Actions | — | tests + Supabase keepalive (3日おき) |
| Runtime | Node.js | 20+ (Edge では V8 isolate) | 開発時 + Workers では Edge |

---

## アーキテクチャ概要

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
              │  │ orders sync   (6時間ごと)    │  │        │
              │  │ inventory sync(6時間ごと)    │  │        │
              │  │ sales sync    (日次)         │  │        │
              │  │ products sync (週次)         │  │        │
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
              │  GitHub Actions (3日おき)        │         │
              │  Supabase keepalive ───────────────────────┘
              │  (Free plan auto-pause 回避)     │
              └──────────────────────────────────┘
```

---

## 主要機能

### 1. SP-API LWA OAuth 認証フロー(`packages/pipeline/src/lib/lwa-auth.ts`)
LWA (Login with Amazon) の OAuth 2.0 refresh_token フローを実装。`grant_type=refresh_token` で access_token を取得し、有効期限内は in-memory cache で再利用。token 失効時は自動 refresh。LWA endpoint は北米 (`https://api.amazon.com/auth/o2/token`) 固定で、SP-API endpoint とは独立している点を抽象化。

### 2. AES-256-GCM 暗号化(`packages/pipeline/src/lib/encryption.ts`)
credentials (refresh_token, client_secret 等) を AES-256-GCM で暗号化。`v1:<iv_base64>:<tag_base64>:<ct_base64>` 形式で保存し、key version をプレフィックスに含めることで将来の key rotation に対応。`ENCRYPTION_KEY` env で 32 byte の master key を管理、IV は per-encryption でランダム生成。

### 3. SpApiClient(`packages/pipeline/src/lib/sp-api-client.ts`)
SP-API への HTTPS リクエストを一元管理する client class。axios + axios-retry で 5xx + 429 自動 retry、Token Bucket rate limiter で透過的 throttle、region routing で marketplace_id → endpoint 自動選択を実装。`__spApiOperation` symbol でリクエストごとの operation 識別子を漏れなく付与し、bucket key 計算を保証。

### 4. Token Bucket Rate Limiter(`packages/pipeline/src/lib/token-bucket.ts` + `rate-limits.ts`)
SP-API は operation ごとに rate limit が独立している(getOrders と getInventorySummaries で別 bucket)。bucket key を `<operation>:<region>` 形式にし、operation 単位 × region 単位で完全独立。固定 rate での bucket 消費を基本とし、429 hit 時には `x-amzn-RateLimit-Limit` header から動的 drain を実行。drain overlap が発生した場合は長い方を採用、refill は drain-end 起点で計算する。

### 5. Multi-region Endpoint Routing(`packages/pipeline/src/lib/sp-api-endpoints.ts`)
marketplace_id (例: `A1F83G8C2ARO7P` = UK = EU region) から自動的に SP-API endpoint を解決。`SANDBOX_ENDPOINTS` map を使い、不明な marketplace_id は **明示的に throw**(silent fallback しない、寸止め原則の構造的保証)。NA / EU / FE の 3 リージョン対応、各リージョンで Sandbox endpoint URL は test 固定。

### 6. 4 Sync Workers(`packages/pipeline/src/workers/`)
Amazon EC 運営に必要な 4 種データを独立 worker として実装:
- **orders sync**: getOrders で過去 N 時間の注文を取得、upsert with onConflict
- **inventory sync**: getInventorySummaries で FBA 在庫を取得
- **sales-reports sync**: 日次レポート行を `sales_reports`(seller × marketplace × report_date × sku 粒度)に upsert
- **products sync**: searchCatalogItems で商品マスタを更新

各 worker は `runMarketplaceBatch` 関数(`packages/pipeline/src/lib/sync-helpers.ts`)を共通で使用し、複数 marketplace を並列処理。`sync_logs` に marketplace 単位で N 行記録 + `job_run_id (uuid)` で部分失敗を追跡可能。失敗時は synthetic failed row を sync_logs に挿入。

### 7. Sync Job Tracking(`sync_logs` table)
1 batch 実行ごとに (seller, marketplace, job_type) 単位で 1 行を挿入し、同一 orchestrator run 内の行は同じ `job_run_id` を共有。これにより部分失敗が可視化される。`status` は `started` / `succeeded` / `failed` / `partial` の 4 値。`records_fetched` / `records_upserted` / `error_code` / `error_message` で実行状況を完全可視化。データテーブル側では Amazon 由来の `last_update_date` と pipeline 側の `fetched_at` を別カラムに保持しているため、「Amazon 側の停滞」と「pipeline 側の停止」を切り分けられる。

### 8. Cloudflare Workers Cron Schedules(`packages/cloudflare-worker/src/index.ts`)
`scheduled()` handler で 4 種の cron を管理:

| Worker | Cron | 頻度 |
|---|---|---|
| orders sync | `0 */6 * * *` | 6 時間ごと、毎正時 |
| inventory sync | `15 */6 * * *` | 6 時間ごと、+15 分オフセット(orders と負荷分散) |
| sales-reports sync | `0 0 * * *` | 日次 00:00 UTC |
| products sync | `0 0 * * 0` | 週次、日曜 00:00 UTC |

Cloudflare Workers Cron は同 Worker 内で 5 個まで設定可能で、4 個に収めることで余裕を確保。`packages/pipeline` を直接 import して再利用、`nodejs_compat` flag で Node 標準ライブラリ互換。

### 9. Edge Runtime Dashboard(`packages/frontend/`)
Next.js 15 App Router で 2 ページ構成:
- `/`: 全 seller の一覧、最新の sync_logs サマリ、Sandbox demo bar
- `/sellers/[sellerId]`: seller 詳細、marketplace 別 sync 状況、最近の orders / inventory snapshot

Server Components で Supabase から直接 fetch し、Edge Runtime (`export const runtime = 'edge'`) で実行。Next 15 の async params API に対応(`params: Promise<{ sellerId: string }>` で受け取り `await params` で展開)。`sellers_public` view (security_invoker) を使い、demo seller のみを公開。React 19 の Server Components 改善と組み合わせ、初期描画レイテンシを最小化。

### 10. Sandbox Demo Banner
全ページ上部に常駐バナー: **"Sandbox Demo — Connected to SP-API Sandbox endpoint. Production credentials require a separate engagement."**
寸止め原則を明示しつつ、Production engagement への橋渡しメッセージを兼ねる Upwork 訴求設計。

### 11. Supabase Keepalive(`.github/workflows/keepalive.yml`)
Supabase Free Plan は 7 日間 inactive で auto-pause される。GitHub Actions で 3 日おきに PostgREST 経由の `SELECT id FROM sellers LIMIT 1` を発行して auto-pause を回避。寸止め原則($0/月)を維持しつつ、デモを常時稼働させる仕組み。

---

## データベース設計

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
└─────────────────────────────────────┘    │   カラムは公開しない              │
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
  0004_phase5_anon_grant.sql    — table-level GRANT SELECT to anon (RLS は引き続き行を絞る)

RLS: 全テーブルで RLS 有効。service_role は RLS bypass(cron pipeline で使用)。
     authenticated 読みは sellers.owner_user_id = auth.uid() で seller 単位に scoped。
     anon 読みは is_demo = true で demo seller に scoped(0003 で追加)。
upsert pattern: ON CONFLICT (<natural_key>) DO UPDATE。updated_at は trigger で自動更新。
```

---

## 画面仕様

### Sellers 一覧 (`/`)
- ページ最上部に Sandbox Demo バナーを常駐(amber 背景)。Sandbox-only である旨と Production engagement への橋渡しを明示。
- Demo seller の card grid(`sellers_public` view から fetch)。
- 各カード: display name、masked selling-partner ID、region、marketplace の国旗 chip、recent runs / succeeded / failed カウント、最新 run のサマリと `details →` リンク。

### Seller 詳細 (`/sellers/[sellerId]`)
- ヘッダ: display name、masked selling-partner ID、region、active/inactive バッジ。
- 「Marketplaces · latest sync per job」テーブル: 当該 seller が enabled にしている marketplace について、`job_type`(orders / inventory / sales_reports / products)ごとの最新 log を、status badge / relative time / 行数 / duration で表示。
- 「Recent orchestrator runs」: 直近 5 run を `job_run_id` で grouping し、各 run の per-job 行(badge / job / marketplace / 行数 / duration / 任意の error code)を一覧表示。

---

## API エンドポイント

| メソッド | パス | Runtime | 認証 | 説明 |
|---------|------|---------|------|------|
| GET | `/` | Edge | Public(demo) | Sellers 一覧ページ(Server Component fetch) |
| GET | `/sellers/[sellerId]` | Edge | Public(demo) | Seller 詳細ページ(Server Component fetch) |
| Cron | `0 */6 * * *` | Workers | Internal | orders sync trigger |
| Cron | `15 */6 * * *` | Workers | Internal | inventory sync trigger(+15 分オフセット) |
| Cron | `0 0 * * *` | Workers | Internal | sales-reports sync trigger(日次) |
| Cron | `0 0 * * 0` | Workers | Internal | products sync trigger(週次、日曜) |

> 本プロジェクトは Server Components 中心の設計のため、API Routes は最小化。データ取得は Supabase からの直接 fetch + RLS で完結。

---

## プロジェクト構成

**全体規模:** TypeScript / TSX 合計 **5,907 行**(node_modules / .next / .vercel 除く、tests 含む)

| Package | LOC | 内訳 |
|---------|-----|------|
| `packages/pipeline/` | **4,108 行** | SP-API client / encryption / token-bucket / rate-limits / region routing / 4 sync workers / zod schemas / 55 tests |
| `packages/frontend/` | **1,118 行** | Next.js 15 App Router / Edge Runtime pages / Supabase queries / components / 24 tests |
| `packages/cloudflare-worker/` | **681 行** | scheduled() handler / 4 cron handlers / pipeline workspace 再利用 / 20 tests |
| **Total** | **5,907 行** | |

```
amazon-pulse/                              monorepo (npm workspaces)
├── packages/
│   ├── pipeline/                          4,108 LOC
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── encryption.ts            AES-256-GCM 暗号化
│   │   │   │   ├── lwa-auth.ts              LWA OAuth refresh flow
│   │   │   │   ├── sp-api-client.ts         SP-API HTTP client
│   │   │   │   ├── supabase-client.ts       Supabase 接続管理
│   │   │   │   ├── token-bucket.ts          Token Bucket rate limiter
│   │   │   │   ├── rate-limits.ts           operation-level rate config
│   │   │   │   ├── sp-api-endpoints.ts      region routing
│   │   │   │   └── sync-helpers.ts          runMarketplaceBatch + sync_logs writer
│   │   │   ├── schemas/                     zod schema (Swagger 準拠)
│   │   │   └── workers/
│   │   │       ├── sync-orders.ts           orders sync worker
│   │   │       ├── sync-inventory.ts        inventory sync worker
│   │   │       ├── sync-sales-reports.ts    sales-reports sync worker
│   │   │       └── sync-products.ts         products sync worker
│   │   └── tests/                           55 tests (FakeSupabase + URL fix)
│   │
│   ├── frontend/                          1,118 LOC
│   │   ├── app/
│   │   │   ├── page.tsx                   Sellers 一覧 (Edge Runtime)
│   │   │   ├── sellers/
│   │   │   │   └── [sellerId]/
│   │   │   │       └── page.tsx           Seller 詳細 (Edge Runtime, async params)
│   │   │   └── layout.tsx                 Sandbox Demo Banner 配置
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
│       │   ├── 0002_phase2_sync_columns.sql sync_logs.job_run_id + 索引
│       │   ├── 0003_phase5_demo_access.sql  is_demo flag + sellers_public view
│       │   └── 0004_phase5_anon_grant.sql   table-level GRANT SELECT to anon
│       └── seed.sql                         合成 demo データセット
│
├── .github/
│   └── workflows/
│       ├── ci.yml                         push/PR で typecheck + tests
│       └── keepalive.yml                  Supabase へ REST ping を 3 日おき
│
├── package.json                           workspaces 定義
├── tsconfig.json                          strict + noUncheckedIndexedAccess
└── README.md                              Upwork 訴求版
```

---

## セットアップ

### 前提条件

- Node.js 20+ & npm 10+
- Cloudflare アカウント(Free Plan)
- Supabase アカウント(Free Plan)
- Amazon SP-API Sandbox app 登録済み(Sandbox endpoint のみ使用、Production credentials 不要)

### 手順

```bash
# リポジトリのクローン
git clone https://github.com/mer-prog/amazon-pulse.git
cd amazon-pulse

# 依存関係のインストール
npm install

# Supabase migrations 適用(順序固定)
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0002_phase2_sync_columns.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0003_phase5_demo_access.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0004_phase5_anon_grant.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/seed.sql

# Sandbox app credentials を暗号化して Supabase に登録
# (詳細は README 参照)

# Cloudflare Pages デプロイ
npm run build:cf --workspace=packages/frontend
# → packages/frontend/.vercel/output/static/ を Cloudflare Pages にデプロイ

# Cloudflare Workers デプロイ
cd packages/cloudflare-worker
npx wrangler deploy
```

### 環境変数

| 変数 | 説明 | 必須 |
|------|------|------|
| `SUPABASE_URL` | Supabase Project URL | はい |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (Workers 用) | はい |
| `NEXT_PUBLIC_SUPABASE_URL` | 同 URL(frontend Edge Runtime 用) | はい |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (frontend 用) | はい |
| `ENCRYPTION_KEY` | 32 byte の AES-256-GCM master key (base64) | はい |
| `SP_API_CLIENT_ID` | LWA app client ID(SP-API で使用) | はい |
| `SP_API_CLIENT_SECRET` | LWA app client secret(SP-API で使用) | はい |

### Cloudflare Pages 設定

| 項目 | 値 |
|---|---|
| Framework preset | Next.js |
| Build command | `npm run build:cf --workspace=packages/frontend` |
| Build output directory | `packages/frontend/.vercel/output/static` |
| Compatibility flags | `nodejs_compat`(Production + Preview) |

---

## セキュリティ設計

| 対策 | 実装内容 |
|------|----------|
| Credentials 暗号化 | AES-256-GCM (`v1:<iv>:<tag>:<ct>` 形式)で refresh_token を暗号化保存。key rotation 対応 |
| LWA OAuth | refresh_token フローでアクセストークンを動的取得。長期 credentials は暗号化済み DB のみ |
| Multi-tenancy 分離 | 全 query に seller_id フィルタ。RLS + sellers_public view (security_invoker) で demo / 本番を分離 |
| Sandbox-only mode | SANDBOX_ENDPOINTS map で endpoint URL を固定。Production endpoint へのアクセスを構造的に防止 |
| 不明 marketplace_id throw | region routing で未定義 marketplace_id は throw(silent fallback 禁止) |
| Edge Runtime + nodejs_compat | Cloudflare Workers の V8 isolate で実行、攻撃面を最小化。Node 互換は明示 flag で限定 |
| Token Bucket throttle | 429 を発生前に防ぐ rate limiter で SP-API 規約違反を回避 |
| GitHub Actions secrets | env は GitHub Secrets で管理、log には流出しない設計 |

---

## 設計判断の根拠

| 判断 | 根拠 |
|------|------|
| **Sandbox-only 寸止め実装** | Production credentials の取得は KYB 等の負担が大きく、Portfolio 用途では Sandbox で十分。Sandbox バナー文言で Production engagement への橋渡しを明示 |
| **monorepo (npm workspaces)** | pipeline / frontend / cloudflare-worker で同一の zod schema・型定義を共有。重複コードを削減し、変更追跡が容易 |
| **Token Bucket を operation 単位 × region 単位で独立** | SP-API の rate limit は operation × region で独立しているため、bucket key も同じ粒度にすることで rate limit 違反を最小化 |
| **drain overlap で長い方を採用、refill drain-end 起点** | 複数の 429 hit が短期間に発生した場合の bucket 状態を一貫させる。短い方を採用すると drain が早期解除され rate limit に再 hit するリスク |
| **sync_logs に marketplace 単位で N 行 + job_run_id** | 1 batch の中で部分的に失敗した marketplace を可視化できる。1 行集約だと失敗 marketplace の特定が困難 |
| **upsert with onConflict pattern** | SP-API の境界時刻問題(同 record が複数 batch で取得される)に対し、`ON CONFLICT DO UPDATE SET synced_at = NOW()` で冪等性を保証 |
| **updated_at vs synced_at 分離** | Amazon 側の更新時刻と pipeline 側の同期時刻を独立追跡。「Amazon 側の更新が滞った」のか「pipeline が止まった」のかを切り分け可能 |
| **不明 marketplace_id を明示 throw** | silent fallback を許すと、誤った endpoint への routing が静かに発生する。寸止め原則の構造的保証として明示 throw |
| **@cloudflare/next-on-pages 採用** | Vercel 移行ではなく、Cloudflare Workers + Pages で完結させるため。Workers Cron との自然な連携、Free Plan 維持、Edge Runtime での低レイテンシが Upwork 訴求点 |
| **TypeScript strict + noUncheckedIndexedAccess** | 配列アクセスを T \| undefined 化することで、Production runtime での undefined 起因 crash を型レベルで防止 |
| **Next.js 15 + React 19 採用** | `@cloudflare/next-on-pages` の peer dep が `next >= 14.3.0` を要求。Next.js 14.x stable は 14.2 で打ち止めのため、最新 stable の Next 15 に bump。React 19 も同時 bump し、async params API / fetch cache 改善 / RSC streaming 等の最新機能を活用。Upwork ポートフォリオとしての訴求力も強化 |
| **`@cloudflare/next-on-pages` 採用(将来 OpenNext 移行検討)** | 現在 Cloudflare 公式は OpenNext への推奨を移行中。本プロジェクトは現時点で安定稼働実績のある next-on-pages を採用しつつ、将来 Wave で OpenNext へ移行する想定。adapter 層を抽象化することで切り替えコスト最小化 |
| **zod .passthrough() 活用** | Amazon が SP-API レスポンスに新 field を追加しても strict parse で fail しない。後方互換性を構造的に確保 |
| **Supabase keepalive (GitHub Actions)** | Supabase Free Plan の 7日 auto-pause を $0 で回避。Pro Plan ($25/月) 不要 |
| **Cloudflare Workers Cron 4 個** | Cloudflare Free Plan の Cron 制限(同 Worker 内 5 個まで)に余裕をもって収める設計 |

---

## 運用コスト

| サービス | プラン | 月額 |
|----------|--------|------|
| Cloudflare Pages | Free Plan(500 builds/mo, unlimited bandwidth) | $0 |
| Cloudflare Workers | Free Plan(100k requests/day, Cron 5/Worker) | $0 |
| Supabase | Free Plan(500MB DB + GitHub Actions keepalive) | $0 |
| GitHub Actions | Free tier(2000 min/mo) | $0 |
| Amazon SP-API Sandbox | 無料(Sandbox endpoint のみ) | $0 |
| LWA app | 無料(Login with Amazon) | $0 |
| **合計** | | **$0** |

> Production engagement(実 Seller との契約)時には Supabase Pro($25)・Cloudflare Workers Paid($5)が必要になる想定。Sandbox demo は完全 $0 で永続稼働。

---

## 作者

[@mer-prog](https://github.com/mer-prog)
