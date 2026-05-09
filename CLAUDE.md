# CLAUDE.md — amazon-pulse 作業コンテキスト

このファイルは Claude（および将来のコントリビュータ）向けの作業ガイドライン。

## プロジェクト概要

Amazon EU/UK seller 向けに **SP-API（Selling Partner API）** から販売・在庫・注文データを取得し、**PostgreSQL（Supabase）** に統合する production-grade データパイプライン。

- **対象**: Amazon EU/UK marketplaces（DE / FR / IT / ES / UK）
- **データ種別**: orders / order_items / inventory / sales_reports / products
- **ストレージ**: Supabase（PostgreSQL, ap-northeast-1 / Tokyo）
- **スケジューラ**: Cloudflare Workers Cron Triggers
- **Web UI**: Next.js 15 App Router (React 19)

## 寸止め原則（絶対遵守）

このフェーズはお金をかけずに完成度を上げる「**Sandbox-first**」開発。以下は厳守。

1. **SP-API は Sandbox 専用 credentials のみ使用**
   - Endpoint: `https://sandbox.sellingpartnerapi-eu.amazon.com`
   - Static + Dynamic Sandbox の両方を活用
   - Production endpoint は本フェーズでは絶対に叩かない

2. **Cron は Cloudflare Workers Cron Triggers**
   - 有償の Background Worker は使わない
   - Free プラン CPU 10ms 制限を意識した実装（外部 API call は wall time 支配なので問題ないが、JSON parse などで CPU 時間を消費しないよう設計）

3. **Supabase Free tier**
   - project: `amazon-pulse-db`（ap-northeast-1 / Tokyo）
   - RLS は最初から有効化、auto-expose new tables は OFF
   - service_role key はサーバ環境のみで使用

4. **コミットコスト最小化**
   - clone するだけで全機能デモ可能になる seed.sql を含める
   - Sandbox credentials は `.env.example` にダミー値で記載、実値は `.env.local`（gitignore 対象）

## ディレクトリ構造

```
amazon-pulse/
├── README.md
├── CLAUDE.md
├── .env.example
├── .gitignore
├── LICENSE
├── package.json                    # workspaces root
├── tsconfig.json                   # base TS config
├── packages/
│   ├── pipeline/                   # Node.js sync worker
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── lwa-auth.ts
│   │   │   │   ├── sp-api-client.ts
│   │   │   │   ├── rate-limiter.ts
│   │   │   │   ├── supabase-client.ts
│   │   │   │   └── encryption.ts
│   │   │   ├── workers/
│   │   │   │   ├── sync-orders.ts
│   │   │   │   ├── sync-inventory.ts
│   │   │   │   ├── sync-sales-reports.ts
│   │   │   │   └── sync-products.ts
│   │   │   ├── schemas/             # zod
│   │   │   └── index.ts
│   │   └── tests/
│   ├── cloudflare-worker/          # Cron Trigger
│   │   ├── src/index.ts
│   │   ├── wrangler.toml
│   │   └── package.json
│   └── frontend/                   # Next.js 15 + React 19 Web UI
│       ├── app/
│       └── package.json
└── infrastructure/
    └── supabase/
        ├── migrations/
        │   └── 0001_initial_schema.sql
        └── seed.sql
```

## 技術スタック

- Node.js 20+
- TypeScript 5.4 strict mode
- @supabase/supabase-js
- axios + axios-retry
- p-queue（rate limit）
- zod（schema validation）
- Cloudflare Workers + Wrangler
- Next.js 15 App Router + React 19
- Vitest

## Phase 別ロードマップ

| Phase | 内容 | Day | Status |
|-------|------|-----|--------|
| 1 | LWA OAuth + SP-API client wrapper | 1 | ✅ done (commit `321a924`, 9 tests) |
| 2 | Data Pipeline 4種（orders / inventory / sales_reports / products） | 2 | ✅ done (commit `6ace2e8`, 16 tests, migration 0002) |
| 3 | Rate Limit + Retry（token bucket / exponential backoff） | 3 | ✅ done (commit `e1a97b9`, 12 tests) |
| 4 | EU/UK Multi-Region routing | 3 | ✅ done (commit `ae6984b`, 12 tests) |
| 5 | Web UI + Cloudflare Cron deploy | 4 | ✅ done (50 tests, migration 0003) |

**Wave 1 complete** — 99 unit tests passing, 1 sandbox integration test skipped without credentials.

### Phase 5 deliverables

- `infrastructure/supabase/migrations/0003_phase5_demo_access.sql` — `sellers.is_demo` flag + anon-read RLS policies for the dashboard. The `sellers_public` view (security_invoker) hides the encrypted refresh_token column even if a future policy regression were to expose the table.
- `packages/frontend/` — Next.js 15 App Router + React 19 dashboard (Tailwind, in-house ui primitives), 24 tests. Uses **only** the public `anon` key; demo data is gated by `is_demo = true`. "Sandbox Demo" banner pinned at the top. Edge runtime (`runtime = 'edge'`) on both routes; deployed via `@cloudflare/next-on-pages`.
- `packages/cloudflare-worker/` — `scheduled()` entry + per-job handlers (orders / inventory / sales_reports / products). Routes by cron string via `dispatch.ts`. `nodejs_compat` flag mirrors the env binding into `process.env` so the existing pipeline modules work unchanged.
- `wrangler.toml` — 4 cron triggers (1 slot reserved):
  - `0 */6 * * *`  → orders
  - `15 */6 * * *` → inventory (offset to spread load)
  - `0 0 * * *`    → sales_reports
  - `0 0 * * 0`    → products (weekly)
- README.md — Upwork-facing rewrite: mermaid architecture diagram, key features, deployment steps for both Cloudflare Pages (Dashboard) and `wrangler deploy`.

### Phase 5 design decisions

1. **Frontend uses the anon key, RLS gates everything**. The service-role key never crosses the wire. The dashboard reads the `sellers_public` view (column-filtered) instead of `public.sellers` directly — belt and braces.
2. **CF Worker reuses the pipeline package via workspace import**. `nodejs_compat` flag + `populateProcessEnv()` shim avoids any pipeline refactor. `tsconfig paths` in the Worker package points `@amazon-pulse/pipeline` at `../pipeline/src/index.ts` so typecheck works without a pre-built `dist/`.
3. **`runMarketplaceBatch` is the orchestrator inside the Worker** — region grouping + partial-failure isolation come for free from Phase 4.
4. **Weekly + daily + 6h slots fit Free plan's 5-cron limit** with one trigger held in reserve.
5. **Demo banner copy is portfolio-savvy**: explicitly Sandbox + leaves the door open for a paid production engagement.

## 作業ルール

1. **各 Phase 完了で git commit + push**
   - Commit message 規約: `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`
   - 例: `feat(pipeline): add LWA token exchange client`

2. **TypeScript strict mode 必須**
   - `"strict": true`
   - `"noUncheckedIndexedAccess": true` を推奨

3. **secret は絶対 commit しない**
   - `.env*` は gitignore 済み
   - `.env.example` は dummy value のみ

4. **不明点があれば実装を止めて確認**

## 開発ブランチ

- 作業ブランチ: `claude/amazon-pulse-wave-1-vM0W8`
- main への merge は PR review 後

## 参考: SP-API ドキュメント

- Sandbox: <https://developer-docs.amazon.com/sp-api/docs/the-selling-partner-api-sandbox>
- LWA: <https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api>
- Endpoints (EU): `https://sellingpartnerapi-eu.amazon.com`
- Sandbox Endpoints (EU): `https://sandbox.sellingpartnerapi-eu.amazon.com`
