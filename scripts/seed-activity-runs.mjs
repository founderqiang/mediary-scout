// Queue several REAL movie acquisitions via queueMovieAcquisition (the same entry
// point the web action uses) into the dev Postgres, for the activity-page live e2e:
// the in-process worker consumes them one at a time, so there's a running one (watch
// the ticker) plus queued ones (test cancel-via-UI). Args = title:year pairs, or a
// default fresh set.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./_lib/pan115-cookie.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv();
const conn = process.env.MEDIA_TRACK_POSTGRES_URL ?? "postgresql://mediatrack:mediatrack@localhost:5432/media_track";
const mod = await import(path.join(repoRoot, "packages/workflow/dist/index.js"));
const repo = mod.createPostgresWorkflowRepositorySync({ connectionString: conn });

// title|year|tmdbId — fresh (not already tracked) so each reserves a new run.
const movies = [
  ["飞驰人生2", 2024, 996154],
  ["抓娃娃", 2024, 1226578],
  ["默杀2", 2024, 1357640],
];

for (const [title, year, tmdbId] of movies) {
  const mt = { id: `tmdb_movie_${tmdbId}`, tmdbId, type: "movie", title, originalTitle: title, year, aliases: [], posterPath: null };
  const r = await mod.queueMovieAcquisition({ title: mt, keyword: title, repository: repo });
  console.log("queued", title, "→", r.status, r.workflowRunId);
}
await repo.close?.();
