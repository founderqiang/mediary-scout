import { describe, expect, it } from "vitest";
import {
  createEpisodeStates,
  episodeCode,
  FakeAgentNodes,
  FakeResourceProvider,
  FakeStorageExecutor,
  reconcileVerifiedFiles,
  type TrackedSeason,
  type VerifiedFile,
} from "../src/index.js";

describe("episode state semantics", () => {
  it("creates visible future episodes without making them obtained", () => {
    const episodes = createEpisodeStates({
      trackedSeasonId: "season_1",
      seasonNumber: 1,
      totalEpisodes: 24,
      latestAiredEpisode: 14,
    });

    expect(episodes).toHaveLength(24);
    expect(episodes.every((episode) => episode.obtained === false)).toBe(true);
    expect(episodes.every((episode) => episode.metadataStatus === "confirmed")).toBe(true);
    expect(episodes[0]).toMatchObject({
      episodeCode: "S01E01",
      airStatus: "aired",
      obtained: false,
      metadataStatus: "confirmed",
    });
    expect(episodes[13]).toMatchObject({
      episodeCode: "S01E14",
      airStatus: "aired",
      obtained: false,
      metadataStatus: "confirmed",
    });
    expect(episodes[14]).toMatchObject({
      episodeCode: "S01E15",
      airStatus: "unaired",
      obtained: false,
      metadataStatus: "confirmed",
    });
  });

  it("records verified files ahead of TMDB as provider ahead", () => {
    const season: TrackedSeason = {
      id: "season_1",
      mediaTitleId: "title_1",
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_1",
      totalEpisodes: 24,
      latestAiredEpisode: 20,
      latestAiredSource: "metadata",
    };
    const episodes = createEpisodeStates({
      trackedSeasonId: season.id,
      seasonNumber: season.seasonNumber,
      totalEpisodes: season.totalEpisodes,
      latestAiredEpisode: season.latestAiredEpisode,
    });
    const files: VerifiedFile[] = [
      {
        id: "file_21",
        storageDirectoryId: "dir_1",
        name: "Show.S01E21.mkv",
        sizeBytes: 100,
        episodeCode: "S01E21",
        providerFileId: "provider_21",
      },
    ];

    const reconciled = reconcileVerifiedFiles({
      season,
      episodes,
      files,
    });

    expect(reconciled.find((episode) => episode.episodeCode === "S01E21")).toMatchObject({
      obtained: true,
      metadataStatus: "provider_ahead",
      verifiedFileIds: ["file_21"],
    });
  });

  it("sorts reconciled episodes by numeric season and episode", () => {
    const season: TrackedSeason = {
      id: "season_1",
      mediaTitleId: "title_1",
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_1",
      totalEpisodes: 0,
      latestAiredEpisode: 100,
      latestAiredSource: "metadata",
    };
    const files: VerifiedFile[] = [
      {
        id: "file_100",
        storageDirectoryId: "dir_1",
        name: "Show.S01E100.mkv",
        sizeBytes: 100,
        episodeCode: "S01E100",
        providerFileId: "provider_100",
      },
      {
        id: "file_99",
        storageDirectoryId: "dir_1",
        name: "Show.S01E99.mkv",
        sizeBytes: 99,
        episodeCode: "S01E99",
        providerFileId: "provider_99",
      },
    ];

    const reconciled = reconcileVerifiedFiles({
      season,
      episodes: [],
      files,
    });

    expect(reconciled.map((episode) => episode.episodeCode)).toEqual(["S01E99", "S01E100"]);
  });

  it("ignores verified files from other storage directories", () => {
    const season: TrackedSeason = {
      id: "season_1",
      mediaTitleId: "title_1",
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_1",
      totalEpisodes: 24,
      latestAiredEpisode: 20,
      latestAiredSource: "metadata",
    };
    const episodes = createEpisodeStates({
      trackedSeasonId: season.id,
      seasonNumber: season.seasonNumber,
      totalEpisodes: season.totalEpisodes,
      latestAiredEpisode: season.latestAiredEpisode,
    });
    const files: VerifiedFile[] = [
      {
        id: "file_05",
        storageDirectoryId: "dir_2",
        name: "Show.S01E05.mkv",
        sizeBytes: 100,
        episodeCode: "S01E05",
        providerFileId: "provider_05",
      },
    ];

    const reconciled = reconcileVerifiedFiles({
      season,
      episodes,
      files,
    });

    expect(reconciled.find((episode) => episode.episodeCode === "S01E05")).toMatchObject({
      obtained: false,
      verifiedFileIds: [],
    });
  });

  it("formats episode codes consistently", () => {
    expect(episodeCode(1, 1)).toBe("S01E01");
    expect(episodeCode(12, 34)).toBe("S12E34");
  });
});

describe("fake adapters", () => {
  it("keeps resource candidate ordering stable in snapshots", async () => {
    const provider = new FakeResourceProvider({
      keywordResults: {
        "翘楚 4K": [
          { title: "翘楚 S01E13 4K", episodeHints: ["S01E13"] },
          { title: "翘楚 S01E14 4K", episodeHints: ["S01E14"] },
        ],
      },
    });

    const snapshot = await provider.search({ keyword: "翘楚 4K" });

    expect(snapshot.candidates.map((candidate) => candidate.index)).toEqual([0, 1]);
    expect(snapshot.candidates.map((candidate) => candidate.episodeHints)).toEqual([["S01E13"], ["S01E14"]]);
  });

  it("can simulate a transfer with no target directory change", async () => {
    const storage = new FakeStorageExecutor({
      directories: { dir_1: [] },
      transferOutcomes: {
        candidate_1: {
          status: "no_target_change",
          providerMessage: "already transferred elsewhere",
          files: [],
        },
      },
    });

    const attempt = await storage.transfer({
      workflowRunId: "run_1",
      directoryId: "dir_1",
      candidateId: "candidate_1",
    });
    const files = await storage.listVideoFiles("dir_1");

    expect(attempt.status).toBe("no_target_change");
    expect(files).toEqual([]);
  });

  it("fake agent selects candidates that cover missing episodes", async () => {
    const agent = new FakeAgentNodes();
    const decision = await agent.selectEpisodeCoverage({
      snapshotId: "snapshot_1",
      candidates: [
        {
          id: "candidate_1",
          snapshotId: "snapshot_1",
          index: 0,
          title: "翘楚 S01E13",
          type: "115",
          source: "fake",
          episodeHints: ["S01E13"],
          qualityHints: ["4K"],
          providerPayload: {},
        },
      ],
      missingEpisodes: ["S01E13"],
      latestAiredEpisode: 14,
    });

    expect(decision.selectedCandidateIds).toEqual(["candidate_1"]);
    expect(decision.episodeMapping).toEqual({ candidate_1: ["S01E13"] });
  });
});
