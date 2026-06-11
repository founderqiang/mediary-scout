import type {
  AgentDecision,
  ResourceCandidate,
  ResourceSnapshot,
  TransferAttempt,
  VerifiedFile,
} from "./domain.js";

export interface ResourceProvider {
  search(input: { keyword: string }): Promise<ResourceSnapshot>;
}

export interface StorageExecutor {
  createDirectory(input: { name: string; parentId: string }): Promise<string>;
  listVideoFiles(directoryId: string): Promise<VerifiedFile[]>;
  transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt>;
  flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }>;
  deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }>;
}

export interface AgentNodes {
  generateKeywords(input: {
    title: string;
    aliases: string[];
    missingEpisodes: string[];
    previousErrors: string[];
  }): Promise<{ keywords: string[]; reason: string }>;
  selectEpisodeCoverage(input: {
    snapshotId: string;
    candidates: ResourceCandidate[];
    missingEpisodes: string[];
    latestAiredEpisode: number;
  }): Promise<AgentDecision>;
}
