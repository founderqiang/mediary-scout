import { describe, expect, it } from "vitest";
import { deadLinkKey, deadLinkReason } from "../src/acquisition-v2/dead-links.js";
import { InMemoryWorkflowRepository } from "../src/index.js";

describe("deadLinkKey — the stable identity for a resource link", () => {
  it("keys a 115 share by its share code (host/password/fragment irrelevant)", () => {
    expect(deadLinkKey("https://115cdn.com/s/sww96353nl6?password=g876#")).toEqual({
      key: "115:sww96353nl6",
      kind: "pan115",
    });
    // same share code, different host + no password → same key
    expect(deadLinkKey("https://115.com/s/sww96353nl6")).toEqual({ key: "115:sww96353nl6", kind: "pan115" });
  });

  it("keys a magnet by its lowercased 40-hex infohash, stripping PanSou junk suffixes", () => {
    expect(deadLinkKey("magnet:?xt=urn:btih:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5")).toEqual({
      key: "magnet:edef9b0fc91c9ccdf5b3e43f6cc5278160e81dd5",
      kind: "magnet",
    });
    // the real-world "2160P" junk glued onto the infohash by PanSou is stripped
    expect(deadLinkKey("magnet:?xt=urn:btih:8E39A62E48E3CEDB488355D863A4A27DF8ED720A2160P")).toEqual({
      key: "magnet:8e39a62e48e3cedb488355d863a4a27df8ed720a",
      kind: "magnet",
    });
  });

  it("returns null for a url it cannot identify (never key the unknown)", () => {
    expect(deadLinkKey("https://example.com/whatever")).toBeNull();
    expect(deadLinkKey("")).toBeNull();
  });
});

describe("deadLinkReason — conservative dead detection (a false positive hides a link forever)", () => {
  const dead = (status: string, message: string, kind: "pan115" | "magnet") =>
    deadLinkReason({ status: status as never, providerMessage: message }, kind);

  it("records a 115 share that failed loud with a known death message", () => {
    expect(dead("failed", "链接已过期", "pan115")).toBe("链接已过期");
    expect(dead("failed", "分享已取消", "pan115")).toBe("分享已取消");
    expect(dead("failed", "访问码错误", "pan115")).toBe("访问码错误");
    expect(dead("failed", "错误的链接", "pan115")).toBe("错误的链接");
  });

  it("records a magnet 115 rejected (错误的链接), and a magnet that did NOT 秒传", () => {
    expect(dead("failed", "错误的链接", "magnet")).toBe("错误的链接");
    // ok=true but nothing materialized → no_target_change → dead-for-us (we never wait)
    expect(dead("no_target_change", "; no target video materialized yet", "magnet")).toMatch(/materializ|秒传/);
  });

  it("NEVER records 任务已存在 (errcode 10008) — a prior GOOD task, not a dead link", () => {
    expect(dead("no_target_change", "任务已存在，请勿输入重复的链接地址", "magnet")).toBeNull();
  });

  it("does NOT record an unknown/transient failure (avoid false positives)", () => {
    // a non-death message (e.g. a network blip) must not poison the link forever
    expect(dead("failed", "网络超时，请重试", "pan115")).toBeNull();
    expect(dead("failed", "", "pan115")).toBeNull();
  });

  it("does NOT record a succeeded transfer", () => {
    expect(dead("succeeded", "", "pan115")).toBeNull();
    expect(dead("succeeded", "", "magnet")).toBeNull();
  });
});

describe("WorkflowRepository dead-link store", () => {
  it("records dead keys and lists them back (deduped, idempotent)", async () => {
    const repo = new InMemoryWorkflowRepository();
    expect(await repo.listDeadLinkKeys()).toEqual([]);

    await repo.recordDeadLink({ key: "115:sww96353nl6", kind: "pan115", reason: "链接已过期" });
    await repo.recordDeadLink({ key: "magnet:edef9b0f", kind: "magnet", reason: "no 秒传" });
    // re-recording the same key is a no-op (idempotent), not a duplicate
    await repo.recordDeadLink({ key: "115:sww96353nl6", kind: "pan115", reason: "再次过期" });

    expect(new Set(await repo.listDeadLinkKeys())).toEqual(new Set(["115:sww96353nl6", "magnet:edef9b0f"]));
  });
});
