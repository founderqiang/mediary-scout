import "server-only";
import { DatabaseSync } from "node:sqlite";
import type { MediaSearchCache, MediaSearchCandidate } from "@media-track/workflow";

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h for search results

/**
 * Durable TMDB search cache (tier 2 of the read path: tracked state ->
 * this cache -> live TMDB only on miss). Survives restarts so casual
 * searches never become an API storm.
 */
export class SqliteMediaSearchCache implements MediaSearchCache {
  private readonly database: DatabaseSync;
  private readonly ttlMs: number;

  constructor(database: DatabaseSync, options: { ttlMs?: number } = {}) {
    this.database = database;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tmdb_search_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      )
    `);
  }

  async get(query: string): Promise<MediaSearchCandidate[] | null> {
    const row = this.database
      .prepare("SELECT payload_json, fetched_at FROM tmdb_search_cache WHERE cache_key = ?")
      .get(normalizeKey(query)) as { payload_json: string; fetched_at: number } | undefined;
    if (!row) {
      return null;
    }
    if (Date.now() - row.fetched_at > this.ttlMs) {
      this.database.prepare("DELETE FROM tmdb_search_cache WHERE cache_key = ?").run(normalizeKey(query));
      return null;
    }
    try {
      return JSON.parse(row.payload_json) as MediaSearchCandidate[];
    } catch {
      return null;
    }
  }

  async set(query: string, candidates: MediaSearchCandidate[]): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO tmdb_search_cache (cache_key, payload_json, fetched_at)
         VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
      )
      .run(normalizeKey(query), JSON.stringify(candidates), Date.now());
  }
}

function normalizeKey(query: string): string {
  return query.trim().toLowerCase();
}
