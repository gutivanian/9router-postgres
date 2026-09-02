# 9router-pg — fork changes

Fork of [decolua/9router](https://github.com/decolua/9router). Swaps the SQLite
storage layer for **PostgreSQL** and adds a few provider/combo features.
Everything else (routing, translation, OAuth, dashboard) is unchanged — for
the full product docs (all 40+ providers, RTK token saver, setup guide, etc.)
see [`README_UPSTREAM.md`](./README_UPSTREAM.md).

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
| 10 | **`deploy` branch + `npm run build:standalone`** — build a self-contained `.next/standalone` snapshot locally and ship it to a small VPS instead of building there (see [Deploying](#deploying)). | `scripts/build-standalone.js` |

Full details + env contract: [`MIGRATION_POSTGRES.md`](./MIGRATION_POSTGRES.md).

## Env

Required: `JWT_SECRET`, `INITIAL_PASSWORD`, `DATABASE_URL`.
Managed PG TLS: `DATABASE_CA_CERT` (inline) or `DATABASE_CA_PATH`.
Optional: `PG_POOL_MAX` (default 10 — keep under Aiven free's ~20), `ENABLE_REQUEST_LOGS`, `ALLOW_DB_RESET`.

## History

`git log --oneline 90b52e0..HEAD` — 90b52e0 is the upstream base this fork
branched from.

## Deploying

**Database, pick one:**

| | `DATABASE_URL` | plus |
|---|---|---|
| **Self-hosted (on the VPS)** | `postgresql://ninerouter:ninerouter@127.0.0.1:5433/ninerouter` via `docker-compose.pg.yml` | — |
| **Supabase** | `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require` (session pooler, from *Settings → Database → Connection string*) | `DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=false` |
| **Aiven** | `postgres://avnadmin:<pw>@<host>.aivencloud.com:<port>/defaultdb?sslmode=require` | `DATABASE_CA_CERT="-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"` (one line, from Aiven console; `awk 'BEGIN{ORS="\\n"}1' ca.pem`) |

Schema auto-creates on first boot. Moving data from an old instance:
`node scripts/db-copy.mjs "<OLD_URL>" "<NEW_URL>"` (see `MIGRATION_POSTGRES.md`).

### Option A — `deploy` branch (recommended for small/free-tier VPS)

Building Next.js on a low-RAM/burstable-CPU box (e.g. GCP `e2-micro`) thrashes
badly — swap-backed compilation that takes 2 minutes locally can take over an
hour there. Instead, build locally and ship the finished `.next/standalone`
output; the VPS only ever runs `node`, never `npm install`/`next build`.

```bash
npm run build:standalone      # builds .next/standalone locally
```

Push the standalone output to a dedicated `deploy` branch (no build artifacts
on `master`) — see `scripts/build-standalone.js`'s header comment for why a
scratch `HOME` is needed on Windows. Then on the VPS:

```bash
git clone -b deploy https://github.com/<you>/9router.git
cd 9router
nano .env      # JWT_SECRET, INITIAL_PASSWORD, DATABASE_URL, API_KEY_SECRET, MACHINE_ID_SALT, PORT=20128
node custom-server.js
```

Run it under a process manager so it survives SSH disconnects/reboots:

```bash
sudo npm install -g pm2
PORT=20128 pm2 start custom-server.js --name 9router
pm2 save && pm2 startup   # follow the printed command to enable on boot
```

Open the port in your cloud provider's firewall (GCP: **VPC network →
Firewall** — the newer "Firewall policies" page needs an explicit network
association to take effect; the classic Firewall Rules page doesn't).

### Option B — Docker

It's a long-running Node server — run it as a **container** (the `Dockerfile`
works as-is; see [`DOCKER.md`](./DOCKER.md) for the full compose setup).

```bash
git clone <your fork> && cd 9router
cp .env.example .env      # DATABASE_URL, JWT_SECRET, INITIAL_PASSWORD, API_KEY_SECRET, MACHINE_ID_SALT
docker compose up -d --build
```

Put a reverse proxy (nginx/Caddy) in front of port `20128` for TLS + a domain.

## Companion tool

`../9router-bench` — load generator + step-by-step web UI for hammering this
instance's `/v1/chat/completions`.
