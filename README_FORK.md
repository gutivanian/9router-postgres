# 9router-pg — fork changes

Fork of [decolua/9router](https://github.com/decolua/9router). Swaps the SQLite
storage layer for **PostgreSQL** and adds a few provider/combo features.
Everything else (routing, translation, OAuth, dashboard) is unchanged.

## Quick start

```bash
npm install
cp .env.example .env          # set DATABASE_URL (+ DATABASE_CA_CERT for managed PG)
npm run db:smoke              # verify the storage layer end-to-end
npm run dev                   # dashboard on :20127
```

Schema is created automatically on first connect — no manual DDL.

## What changed

| # | Change | Where |
|---|--------|-------|
| 1 | **SQLite → PostgreSQL.** Single async `pg` adapter, `?`→`$n` rewrite, case-insensitive row proxy, `INSERT … ON CONFLICT` upserts, `information_schema` migrations, `pg_dump` backups. Adapter API is async now (repos + `migrate.js` updated). | `src/lib/db/` |
| 2 | **`DATABASE_CA_CERT`** — inline PEM CA in `.env`, no separate file. `pg_dump` gets it via a temp file. | `src/lib/db/pg.js`, `backup.js` |
| 3 | **`POST /api/settings/database/reset`** — wipe all data tables (keeps schema). Password + `{confirm:"RESET"}` + `ALLOW_DB_RESET` gated. | `src/app/api/settings/database/reset/` |
| 4 | **Connection groups** — a `group` field on API-key connections. Add-key modal (single + bulk, `name|key|group`), "Set Group" bulk action, group badge. | providers page, `connectionsRepo.js` |
| 5 | **`skipIfExists`** on `POST /api/providers` — dedup by API-key value; bulk-add "skip existing" checkbox (default on). | `src/app/api/providers/`, `connectionsRepo.js` |
| 6 | **Search** on the provider page — filter connections by name / email / group. | providers page |
| 7 | **Per-combo account allow-list** — each combo's "Keys" button: restrict a provider to selected groups / individual keys (falls through if none match). Stored in `settings.comboStrategies[combo].accountFilters`. | combos page, `chat.js`, `auth.js` |
| 8 | **Supabase support** — works against the Supavisor transaction pooler (`PG_POOL_MAX=1`); `.env.example` + docs cover both pooler modes. | `pg.js`, docs |
| 9 | **`USAGE_HISTORY_RETENTION_DAYS`** (default 30) — prunes raw `usageHistory` rows older than N days, ≤1×/hour; keeps the DB bounded for a small free tier. | `usageRepo.js` |

Full details + env contract: [`MIGRATION_POSTGRES.md`](./MIGRATION_POSTGRES.md).

## Env

Required: `JWT_SECRET`, `INITIAL_PASSWORD`, `DATABASE_URL`.
Managed PG TLS: `DATABASE_CA_CERT` (inline) or `DATABASE_CA_PATH`.
Optional: `PG_POOL_MAX` (default 10 — keep under Aiven free's ~20), `ENABLE_REQUEST_LOGS`, `ALLOW_DB_RESET`.

## History

`git log --oneline 90b52e0..HEAD` — 90b52e0 is the upstream base this fork
branched from.

## Deploying

It's a long-running Node server — run it as a **container** on a VPS (the
`Dockerfile` works as-is; see [`DOCKER.md`](./DOCKER.md) for the full compose
setup). The DB can be external (Aiven or Supabase) or a Postgres container
alongside it (`docker-compose.pg.yml`).

**Database, pick one:**

| | `DATABASE_URL` | plus |
|---|---|---|
| **Self-hosted (on the VPS)** | `postgresql://ninerouter:ninerouter@127.0.0.1:5433/ninerouter` via `docker-compose.pg.yml` | — |
| **Supabase** | `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require` (session pooler, from *Settings → Database → Connection string*) | `DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=false` |
| **Aiven** | `postgres://avnadmin:<pw>@<host>.aivencloud.com:<port>/defaultdb?sslmode=require` | `DATABASE_CA_CERT="-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"` (one line, from Aiven console; `awk 'BEGIN{ORS="\\n"}1' ca.pem`) |

Schema auto-creates on first boot. Moving data from an old instance:
`node scripts/db-copy.mjs "<OLD_URL>" "<NEW_URL>"` (see `MIGRATION_POSTGRES.md`).

```bash
git clone <your fork> && cd 9router
cp .env.example .env      # DATABASE_URL, JWT_SECRET, INITIAL_PASSWORD, API_KEY_SECRET, MACHINE_ID_SALT
docker compose up -d --build
```

Put a reverse proxy (nginx/Caddy) in front of port `20128` for TLS + a domain.

## Companion tool

`../9router-bench` — load generator + step-by-step web UI for hammering this
instance's `/v1/chat/completions`.
