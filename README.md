# amazon-pulse

Production-grade SP-API (Selling Partner API) data pipeline for Amazon **EU/UK**
sellers. Fetches orders, inventory, sales reports, and product catalog data
from Amazon and consolidates them into a Supabase (PostgreSQL) warehouse.

> **Status**: Wave 1 — sandbox-first development. Production endpoints are
> intentionally not exercised in this phase.

## Stack

- **Runtime**: Node.js 20+, TypeScript 5.4 (strict)
- **Database**: Supabase / PostgreSQL (ap-northeast-1)
- **Scheduler**: Cloudflare Workers Cron Triggers
- **HTTP**: axios + axios-retry
- **Rate limiting**: p-queue (token bucket)
- **Validation**: zod
- **Frontend**: Next.js 14 App Router
- **Tests**: Vitest

## Repository layout

```
packages/
  pipeline/            Sync workers (Node.js)
  cloudflare-worker/   Cron Trigger entrypoint
  frontend/            Next.js 14 dashboard
infrastructure/
  supabase/
    migrations/        SQL migrations
    seed.sql           Mock data for local demo
```

## Getting started

```bash
# 1. Install dependencies (workspaces)
npm install

# 2. Copy environment template
cp .env.example .env.local
#    Fill in the SP-API sandbox credentials and Supabase keys.

# 3. Apply schema + seed against your local Supabase project
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/migrations/0001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f infrastructure/supabase/seed.sql

# 4. Run the pipeline against the SP-API sandbox
npm run pipeline:dev
```

## Phases

| Phase | Scope                                                         |
|-------|---------------------------------------------------------------|
| 1     | LWA OAuth + SP-API client wrapper (sandbox)                   |
| 2     | Sync workers: orders / inventory / sales_reports / products   |
| 3     | Token-bucket rate limiting + exponential backoff retries      |
| 4     | Multi-marketplace routing (UK / DE / FR / IT / ES)            |
| 5     | Web dashboard + Cloudflare Workers Cron deployment            |

See [`CLAUDE.md`](./CLAUDE.md) for the working agreement and design notes.

## Operational notes

### Encryption key

The pipeline encrypts SP-API refresh tokens at rest with AES-256-GCM. Generate
a 32-byte key once and put it in `.env.local` (or `wrangler secret put` for the
Cloudflare Worker):

```bash
openssl rand -base64 32
```

### GitHub Actions secrets

Two workflows live under `.github/workflows/`:

| Workflow             | Trigger                | Secrets needed                          |
|----------------------|------------------------|------------------------------------------|
| `ci.yml`             | push to main / PR      | _(none — sandbox tests auto-skip)_      |
| `keepalive.yml`      | every 3 days / manual  | `SUPABASE_URL`, `SUPABASE_ANON_KEY`     |

Configure the keepalive secrets in **Settings → Secrets and variables →
Actions → New repository secret**:

- `SUPABASE_URL` — e.g. `https://xxxxxxxxxxxx.supabase.co`
- `SUPABASE_ANON_KEY` — the public anon key (RLS still protects rows)

Free-tier Supabase projects auto-pause after 7 days of inactivity; the
keepalive workflow issues a single REST `GET` against `sellers` every 3 days
to keep the project warm.

## License

MIT — see [`LICENSE`](./LICENSE).
