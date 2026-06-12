import type { AcquisitionPlan } from "./domain.js";
import type { AgentNodeTraceEvent } from "./agent-node-runtime.js";
import { validateAcquisitionPlan } from "./plan-validation.js";
import type { AgentNodes, ResourceProvider } from "./ports.js";

export interface AcquisitionPlanningSmokeResult {
  status: "plan_valid" | "plan_invalid" | "agent_error";
  plan: AcquisitionPlan | null;
  snapshots: Array<{ id: string; keyword: string; candidateCount: number }>;
  selectedCandidateTitles: string[];
  validationError: string | null;
  agentError: string | null;
  trace: AgentNodeTraceEvent[];
}

/**
 * Read-only smoke harness: exercises the live planning agent against a real
 * resource provider. Executes NO storage side effects, ever. Its job is to
 * prove that the model endpoint can drive the search tool loop and return a
 * structured plan that passes the output contract.
 */
export async function runAcquisitionPlanningSmoke(input: {
  title: string;
  aliases: string[];
  seasonNumber: number;
  totalEpisodes?: number;
  qualityPreference: string;
  missingEpisodes: string[];
  latestAiredEpisode: number;
  initialKeyword: string;
  agents: AgentNodes;
  resourceProvider: ResourceProvider;
}): Promise<AcquisitionPlanningSmokeResult> {
  try {
    const planning = await input.agents.planAcquisition({
      title: input.title,
      aliases: input.aliases,
      seasons: [
        {
          seasonNumber: input.seasonNumber,
          totalEpisodes: input.totalEpisodes ?? Math.max(input.latestAiredEpisode, 1),
          latestAiredEpisode: input.latestAiredEpisode,
        },
      ],
      qualityPreference: input.qualityPreference,
      missingEpisodes: input.missingEpisodes,
      initialKeyword: input.initialKeyword,
      failureEvidence: [],
      searchResources: async ({ keyword }) => input.resourceProvider.search({ keyword }),
    });
    const snapshots = planning.snapshots.map((snapshot) => ({
      id: snapshot.id,
      keyword: snapshot.keyword,
      candidateCount: snapshot.candidates.length,
    }));
    try {
      const validated = validateAcquisitionPlan({
        plan: planning.plan,
        snapshots: planning.snapshots,
        missingEpisodes: input.missingEpisodes,
        seasonNumbers: [input.seasonNumber],
      });
      return {
        status: "plan_valid",
        plan: planning.plan,
        snapshots,
        selectedCandidateTitles: validated.selectedCandidates.map((selected) => selected.candidate.title),
        validationError: null,
        agentError: null,
        trace: planning.trace,
      };
    } catch (error) {
      return {
        status: "plan_invalid",
        plan: planning.plan,
        snapshots,
        selectedCandidateTitles: [],
        validationError: error instanceof Error ? error.message : String(error),
        agentError: null,
        trace: planning.trace,
      };
    }
  } catch (error) {
    return {
      status: "agent_error",
      plan: null,
      snapshots: [],
      selectedCandidateTitles: [],
      validationError: null,
      agentError: error instanceof Error ? error.message : String(error),
      trace: [],
    };
  }
}
