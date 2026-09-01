// One-off: copy every 9router table from one Postgres to another.
// Overwrites the destination tables (TRUNCATE + re-insert). No schema changes —
// run the app once against the destination first so the schema exists.
//
//   node scripts/db-copy.mjs "<SOURCE_URL>" "<DEST_URL>"
//
// Both URLs may carry ?sslmode=require; TLS is used without cert verification.
import pg from "pg";

const [SRC, DST] = process.argv.slice(2);
if (!SRC || !DST) {
  console.error('usage: node scripts/db-copy.mjs "<SOURCE_URL>" "<DEST_URL>"');
  process.exit(1);
}

// Copy order doesn't matter (no FKs), but keep it stable/readable.
const TABLES = [
  "_meta", "settings", "providerConnections", "providerNodes", "proxyPools",
  "apiKeys", "combos", "kv", "usageDaily", "usageHistory", "requestDetails",
];

const mkClient = (cs) =>
  new pg.Client({ connectionString: cs.replace(/([?&])sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });

const src = mkClient(SRC);
const dst = mkClient(DST);

async function columnsOf(client, table) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1
     ORDER BY ordinal_position`,
    [table.toLowerCase()],
  );
  return r.rows.map((x) => x.column_name);
}

async function copyTable(label) {
  const table = label.toLowerCase(); // schema identifiers are all lower-case
  const srcCols = await columnsOf(src, table);
  const dstCols = await columnsOf(dst, table);
  if (srcCols.length === 0) { console.log(`  ${label}: not on source, skip`); return; }
  if (dstCols.length === 0) { console.log(`  ${label}: not on dest, skip`); return; }
  const cols = srcCols.filter((c) => dstCols.includes(c));

  const rows = (await src.query(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM "${table}"`)).rows;
  await dst.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);

  if (rows.length) {
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const params = [];
      const tuples = slice.map((row, r) => {
        const ph = cols.map((c, k) => `$${r * cols.length + k + 1}`);
        for (const c of cols) params.push(row[c]);
        return `(${ph.join(",")})`;
      });
      await dst.query(
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${tuples.join(",")}`,
        params,
      );
    }
  }

  // Re-sync any identity/serial sequence (usageHistory.id).
  if (cols.includes("id")) {
    try {
      await dst.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                       COALESCE((SELECT MAX(id) FROM "${table}"), 1),
                       (SELECT COUNT(*) FROM "${table}") > 0)
         WHERE pg_get_serial_sequence('"${table}"', 'id') IS NOT NULL`,
      );
    } catch { /* no sequence on this table */ }
  }

  console.log(`  ${table}: ${rows.length} rows`);
}

try {
  await src.connect();
  await dst.connect();
  console.log(`copy  ${new URL(SRC).host}  →  ${new URL(DST).host}`);
  for (const t of TABLES) await copyTable(t);
  console.log("done.");
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await src.end().catch(() => {});
  await dst.end().catch(() => {});
}
