import { describe, expect, it } from "vitest";
import { buildConfirmedDedupPlan, buildDedupPlan, FakeAgentNodes, type VerifiedFile } from "../src/index.js";

function file(id: string, episodeCode: string, sizeBytes: number): VerifiedFile {
  return {
    id,
    storageDirectoryId: "dir_1",
    name: `${id}.mkv`,
    sizeBytes,
    episodeCode,
    providerFileId: id,
  };
}

describe("buildDedupPlan", () => {
  it("keeps the larger file regardless of which transfer brought it (生命树 lesson)", () => {
    const plan = buildDedupPlan({
      files: [
        file("old_e01", "S01E01", 1_200_000_000),
        file("new_e01", "S01E01", 800_000_000),
        file("old_e02", "S01E02", 1_200_000_000),
        file("new_e02", "S01E02", 800_000_000),
        file("only_e13", "S01E13", 800_000_000),
      ],
    });

    expect(plan.deleteFileIds).toEqual(["new_e01", "new_e02"]);
    expect(plan.keepFileIds).toContain("old_e01");
    expect(plan.keepFileIds).toContain("only_e13");
    expect(plan.duplicateGroups).toEqual({
      S01E01: ["old_e01", "new_e01"],
      S01E02: ["old_e02", "new_e02"],
    });
  });

  it("never deletes the sole file of an episode", () => {
    const plan = buildDedupPlan({
      files: [file("a", "S01E01", 1), file("b", "S01E02", 1)],
    });

    expect(plan.deleteFileIds).toEqual([]);
    expect(plan.keepFileIds).toEqual(["a", "b"]);
    expect(plan.duplicateGroups).toEqual({});
  });

  it("breaks size ties by keeping the first file", () => {
    const plan = buildDedupPlan({
      files: [file("first", "S01E01", 1_000), file("second", "S01E01", 1_000)],
    });

    expect(plan.keepFileIds).toEqual(["first"]);
    expect(plan.deleteFileIds).toEqual(["second"]);
  });

  it("handles three-way duplicates keeping only the largest", () => {
    const plan = buildDedupPlan({
      files: [
        file("small", "S01E05", 500),
        file("large", "S01E05", 5_000),
        file("medium", "S01E05", 1_000),
      ],
    });

    expect(plan.keepFileIds).toEqual(["large"]);
    expect(plan.deleteFileIds.sort()).toEqual(["medium", "small"]);
  });
});

describe("buildConfirmedDedupPlan", () => {
  const title = {
    id: "title_anime",
    tmdbId: 99,
    type: "anime" as const,
    title: "Anime",
    originalTitle: "Anime",
    year: 2026,
    aliases: [],
  };

  it("deletes the smaller file only for agent-confirmed duplicate groups", async () => {
    const plan = await buildConfirmedDedupPlan({
      title,
      seasonNumber: 1,
      files: [file("small_e13", "S01E13", 500), file("big_e13", "S01E13", 5_000)],
      agents: new FakeAgentNodes({
        packageRecognition: {
          node: "test",
          fileMappings: [
            { providerFileId: "small_e13", seasonNumber: 1, episodeNumber: 13, confidence: "high", reason: "filename" },
            { providerFileId: "big_e13", seasonNumber: 1, episodeNumber: 13, confidence: "high", reason: "filename" },
          ],
          rejectedProviderFileIds: [],
          confidence: "high",
          reason: "both are episode 13",
        },
      }),
    });

    expect(plan.deleteFileIds).toEqual(["small_e13"]);
    expect(plan.unconfirmedFileIds).toEqual([]);
  });

  it("never deletes when the agent corrects a parser misidentification", async () => {
    // parser put both in S01E07 (release-group number misparse); agent says
    // one of them is actually episode 5 -> they are NOT duplicates.
    const plan = await buildConfirmedDedupPlan({
      title,
      seasonNumber: 1,
      files: [file("group_name_file", "S01E07", 900), file("real_e07", "S01E07", 800)],
      agents: new FakeAgentNodes({
        packageRecognition: {
          node: "test",
          fileMappings: [
            { providerFileId: "group_name_file", seasonNumber: 1, episodeNumber: 5, confidence: "high", reason: "07 is the release group" },
            { providerFileId: "real_e07", seasonNumber: 1, episodeNumber: 7, confidence: "high", reason: "explicit episode" },
          ],
          rejectedProviderFileIds: [],
          confidence: "high",
          reason: "corrected one misparse",
        },
      }),
    });

    expect(plan.deleteFileIds).toEqual([]);
  });

  it("fails safe and keeps everything when the agent does not confirm the mapping", async () => {
    const plan = await buildConfirmedDedupPlan({
      title,
      seasonNumber: 1,
      files: [file("a_e13", "S01E13", 500), file("b_e13", "S01E13", 5_000)],
      agents: new FakeAgentNodes(),
    });

    expect(plan.deleteFileIds).toEqual([]);
    expect(plan.unconfirmedFileIds.sort()).toEqual(["a_e13", "b_e13"]);
  });

  it("does not call the agent at all when no duplicate groups exist", async () => {
    const agents = new FakeAgentNodes();
    agents.recognizePackage = async () => {
      throw new Error("agent must not be called without duplicates");
    };

    const plan = await buildConfirmedDedupPlan({
      title,
      seasonNumber: 1,
      files: [file("a", "S01E01", 1), file("b", "S01E02", 1)],
      agents,
    });

    expect(plan.deleteFileIds).toEqual([]);
  });
});
