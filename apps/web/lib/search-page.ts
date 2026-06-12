import {
  createTmdbSearchProviderFromEnv,
  getSearchPageView,
  InMemoryMediaSearchCache,
  type MediaSearchProvider,
  type SearchPageView,
} from "@media-track/workflow";
import { dashboardStateFromTrackedSeason, type DashboardState } from "./demo-workflow";
import { demoMediaSearchProvider } from "./demo-candidates";
import { SqliteMediaSearchCache } from "./tmdb-cache";
import {
  ensureDemoSeeded,
  getWebDatabase,
  getWorkflowRepository,
  getWorkflowStatusView,
} from "./workflow-runtime";

export interface ProductPageData {
  search: SearchPageView;
  dashboard: DashboardState;
}

let demoSearchCache: InMemoryMediaSearchCache | null = null;
let durableSearchCache: SqliteMediaSearchCache | null = null;
let tmdbSearchProvider: MediaSearchProvider | null = null;

export async function getProductPageData(query: string): Promise<ProductPageData> {
  const [search, dashboard] = await Promise.all([getSearchView(query), getLibraryDashboard()]);

  return {
    search,
    dashboard,
  };
}

export async function getSearchView(query: string): Promise<SearchPageView> {
  const repository = getWorkflowRepository();
  await ensureDemoSeeded(repository);
  return getSearchPageView({
    query,
    provider: getMediaSearchProvider(),
    cache: getSearchCache(),
    repository,
  });
}

export async function getLibraryDashboard(): Promise<DashboardState> {
  const repository = getWorkflowRepository();
  await ensureDemoSeeded(repository);
  const trackedSeason = await getWorkflowStatusView(repository);
  if (!trackedSeason) {
    throw new Error("No tracked seasons are available");
  }
  return dashboardStateFromTrackedSeason(trackedSeason);
}

function getSearchCache() {
  // Live TMDB searches are cached durably in SQLite (6h TTL) so casual
  // browsing never becomes an API storm; the demo provider stays in-memory.
  if (process.env.MEDIA_TRACK_SEARCH_PROVIDER === "tmdb") {
    durableSearchCache ??= new SqliteMediaSearchCache(getWebDatabase());
    return durableSearchCache;
  }
  demoSearchCache ??= new InMemoryMediaSearchCache();
  return demoSearchCache;
}

function getMediaSearchProvider(): MediaSearchProvider {
  if (process.env.MEDIA_TRACK_SEARCH_PROVIDER !== "tmdb") {
    return demoMediaSearchProvider;
  }
  tmdbSearchProvider ??= createTmdbSearchProviderFromEnv();
  return tmdbSearchProvider;
}
