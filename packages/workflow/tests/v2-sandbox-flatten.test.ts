import { describe, expect, it } from "vitest";
import { TaskSandbox } from "../src/acquisition-v2/sandbox.js";
import { FakeResourceProviderV2 } from "../src/acquisition-v2/fake-provider.js";
import { Storage115Simulator } from "../src/acquisition-v2/storage-115-simulator.js";

async function setupExtracted() {
  const provider = new FakeResourceProviderV2({
    results: { show: [{ id: "cand", title: "Show", episodeHints: [], qualityHints: [] }] },
  });
  // Pack nests the episode inside its own wrapper dir + leaves a junk file behind.
  const storage = new Storage115Simulator({
    packs: { cand: { files: [{ path: "[Grp] Show/Show - 01.mkv", sizeBytes: 9 }, { path: "[Grp] Show/cover.jpg", sizeBytes: 1 }] } },
  });
  const stagingDirectoryId = await storage.createDirectory({ name: "staging", parentId: "root" });
  const targetSeasonDirectoryId = await storage.createDirectory({ name: "Season 1", parentId: "root" });
  const sandbox = new TaskSandbox({ provider, storage, stagingDirectoryId, targetSeasonDirectoryId });
  const search = await sandbox.searchResources("show");
  const transfer = await sandbox.transferCandidate({ snapshotId: search.snapshot!.id, candidateId: "cand" });
  // Extract the episode out of the wrapper into Season 1; the empty wrapper + junk remain in staging.
  const videoIds = transfer.staging.filter((f) => f.isVideo).map((f) => f.id);
  await sandbox.moveToSeason({ fileIds: videoIds });
  return { sandbox, storage, stagingDirectoryId };
}

describe("TaskSandbox — flattenPack (clean peel-off of the wrapper dir)", () => {
  it("removes the agent-chosen wrapper subdir from staging (no leftover shell)", async () => {
    const { sandbox } = await setupExtracted();
    const wrapper = (await sandbox.inspectStagingDirs()).find((d) => d.path === "[Grp] Show")!;

    const result = await sandbox.flattenPack({ directoryId: wrapper.id });

    expect(result.staging).toHaveLength(0);
    expect(await sandbox.inspectStagingDirs()).toHaveLength(0);
  });

  it("refuses to flatten a directory that is not inside this task's staging (no root/parent/season)", async () => {
    const { sandbox } = await setupExtracted();
    await expect(sandbox.flattenPack({ directoryId: "root" })).rejects.toThrow(/NOT_IN_STAGING/);
  });
});
