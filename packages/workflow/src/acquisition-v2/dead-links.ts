/**
 * Dead-link identity + detection. A "dead link" is a resource (115 share or
 * magnet) we have PROVEN cannot give us the file — so PanSou results matching a
 * dead key are filtered out before the agent ever sees them, and we never burn a
 * transfer on them again. Recording must be CONSERVATIVE: a false positive hides
 * a real resource forever, so we only record on deterministic death signals.
 */

export type DeadLinkKind = "pan115" | "magnet";

export interface DeadLink {
  /** Stable identity (115:<sharecode> or magnet:<infohash>) — see deadLinkKey. */
  key: string;
  kind: DeadLinkKind;
  reason: string;
  recordedAt: string;
}

/** The DB-backed store of known-dead links (a narrow view of WorkflowRepository). */
export interface DeadLinkStore {
  recordDeadLink(input: { key: string; kind: DeadLinkKind; reason: string; now?: string }): Promise<void>;
  listDeadLinkKeys(): Promise<string[]>;
}

const PAN115_SHARE = /(?:115\.com|115cdn\.com|anxia\.com)\/s\/([0-9a-z]+)/i;
const MAGNET_BTIH = /btih:([0-9a-fA-F]{40})/;

/**
 * The stable identity for a resource url, used BOTH to record a dead link and to
 * match candidates against the dead set. A 115 share is keyed by its share code
 * (host / password / #fragment are irrelevant); a magnet by its lowercased 40-hex
 * infohash (junk PanSou glues on, e.g. a trailing "2160P", is ignored by the
 * fixed-width match). Returns null for anything we cannot identify — we never key
 * the unknown.
 */
export function deadLinkKey(url: string): { key: string; kind: DeadLinkKind } | null {
  const share = url.match(PAN115_SHARE);
  if (share) {
    return { key: `115:${share[1]!.toLowerCase()}`, kind: "pan115" };
  }
  const magnet = url.match(MAGNET_BTIH);
  if (magnet) {
    return { key: `magnet:${magnet[1]!.toLowerCase()}`, kind: "magnet" };
  }
  return null;
}

/** The known fail-loud death messages 115 returns for a dead share/magnet. */
const DEATH_MESSAGE = /链接已过期|分享已取消|访问码错误|错误的链接/;

/**
 * Decide whether a finished transfer attempt PROVES the link is dead, returning
 * the reason to record (or null to leave it alone). Conservative on purpose:
 * - any known 115 death message (share OR magnet reject) → dead;
 * - a magnet that returned no_target_change (ok but nothing 秒传-landed) → dead
 *   for us (we never wait on a slow download) — EXCEPT 任务已存在 (errcode 10008),
 *   which is a prior GOOD task, never a dead link;
 * - an unknown/transient "failed" (e.g. a network blip) → NOT recorded, so a real
 *   resource is never poisoned by a one-off error.
 */
export function deadLinkReason(
  attempt: { status: "succeeded" | "failed" | "no_target_change"; providerMessage: string },
  kind: DeadLinkKind,
): string | null {
  if (attempt.status === "succeeded") {
    return null;
  }
  const message = attempt.providerMessage ?? "";
  if (DEATH_MESSAGE.test(message)) {
    return message;
  }
  if (kind === "magnet" && attempt.status === "no_target_change" && !/任务已存在/.test(message)) {
    return message || "magnet did not 秒传 (no target materialized)";
  }
  return null;
}
