# CLAUDE.md — amazon-pulse 作業コンテキスト

このファイルは Claude（および将来のコントリビュータ）向けの作業ガイドライン。

## プロジェクト概要

Amazon EU/UK seller 向けに **SP-API（Selling Partner API）** から販売・在庫・注文データを取得し、**PostgreSQL（Supabase）** に統合する production-grade データパイプライン。

- **対象**: Amazon EU/UK marketplaces（DE / FR / IT / ES / UK）
- **データ種別**: orders / order_items / inventory / sales_reports / products
- **ストレージ**: Supabase（PostgreSQL, ap-northeast-1 / Tokyo）
- **スケジューラ**: Cloudflare Workers Cron Triggers
- **Web UI**: Next.js 14 App Router

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
│   └── frontend/                   # Next.js 14 Web UI
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
- Next.js 14 App Router
- Vitest

## Phase 別ロードマップ

| Phase | 内容 | Day |
|-------|------|-----|
| 1 | LWA OAuth + SP-API client wrapper | 1 |
| 2 | Data Pipeline 4種（orders / inventory / sales_reports / products） | 2 |
| 3 | Rate Limit + Retry（token bucket / exponential backoff） | 3 |
| 4 | EU/UK Multi-Region routing | 3 |
| 5 | Web UI + Cloudflare Cron deploy | 4 |

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
