#!/usr/bin/env node
// Reset the dev DB's test DATA (media titles, tracked seasons, episodes,
// workflow runs, resource snapshots, decisions, transfer attempts, notifications,
// tmdb cache, ...) while PRESERVING app_settings — the 115 cookie + push config —
// so the user NEVER has to re-QR-login. Credentials are backed up first.
//
// The dev DB is OrbStack Postgres now (the SQLite dev DB has been retired); this
// script TRUNCATEs the Postgres tables the web app actually reads/writes via
// MEDIA_TRACK_POSTGRES_URL. The old SQLite version silently no-op'd on the live DB.
//
//   node scripts/reset-dev-db.mjs          # dry run: back up creds + show plan
//   node scripts/reset-dev-db.mjs --apply  # wipe data rows, keep app_settings

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { loadDotEnv } from "./_lib/pan115-cookie.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESERVE = new Set(["app_settings"]);

loadDotEnv();
const connectionString = process.env.MEDIA_TRACK_POSTGRES_URL?.trim();
if (!connectionString) {
  throw new Error("MEDIA_TRACK_POSTGRES_URL is required (the SQLite dev DB has been retired)");
}

const apply = process.argv.includes("--apply");
const client = new pg.Client({ connectionString });
await client.connect();

try {
  // 1. Back up every setting (cookie, cookieMeta, push_*) to a gitignored file.
  const { rows: settings } = await client.query("SELECT key, value FROM app_settings ORDER BY key");
  const backupPath = path.join(repoRoot, ".media-track-credentials-backup.json");
  writeFileSync(backupPath, JSON.stringify({ savedAt: new Date().toISOString(), settings }, null, 2));
  const cookie = settings.find((s) => s.key === "pan115.cookie");
  console.log(
    `backed up ${settings.length} settings -> ${path.basename(backupPath)} ` +
      `(115 cookie: ${cookie ? "PRESENT len=" + String(cookie.value).length : "MISSING"})`,
  );

  // 2. Plan: every public table except the preserved ones.
  const { rows: tableRows } = await client.query(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const tables = tableRows.map((r) => r.name);
  const toReset = tables.filter((t) => !PRESERVE.has(t));
  console.log("\nall tables:", tables.join(", "));
  console.log("will RESET:", toReset.join(", "));
  console.log("will KEEP :", tables.filter((t) => PRESERVE.has(t)).join(", "));

  if (!apply) {
    console.log("\n(dry run) cookie backed up. pass --apply to wipe data rows.");
  } else {
    if (toReset.length > 0) {
      // Count first so the report shows what was wiped, then TRUNCATE them all in
      // one statement — no FK constraints in this schema, CASCADE is just belt+braces.
      for (const t of toReset) {
        const { rows } = await client.query(`SELECT count(*)::int AS c FROM "${t}"`);
        console.log(`  reset ${t}: ${rows[0].c} -> 0`);
      }
      const identifiers = toReset.map((t) => `"${t}"`).join(", ");
      await client.query(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
    }

    // 3. Verify the 115 cookie survived (it lives in the preserved app_settings).
    const { rows: after } = await client.query("SELECT value FROM app_settings WHERE key = 'pan115.cookie'");
    const value = after[0]?.value;
    console.log(
      `\napp_settings preserved; 115 cookie still present: ${
        value ? "YES len=" + String(value).length : "MISSING (restore from backup!)"
      }`,
    );
  }
} finally {
  await client.end();
}
