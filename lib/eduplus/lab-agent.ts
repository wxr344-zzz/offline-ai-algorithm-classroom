/**
 * The Lab agent: a classroom role the learner selects to ask for the algorithm
 * classroom (maintained simulator and game, guided programming and independent
 * programming Labs). Selecting it, not keyword guessing, decides whether a
 * course gets programming Labs:
 *
 * - selected + algorithm/programming topic → the algorithm classroom with Labs;
 * - selected + any other topic → the learner is told, and the native classroom
 *   is generated (the Teacher still decides, so an unlisted algorithm keeps Labs);
 * - not selected + algorithm topic → maintained simulator and game, no Labs;
 * - not selected + any other topic → the native classroom.
 *
 * Server-safe: no client state.
 */
import { courseIntent } from './course-intent';
import { isExamAlgorithmTopic } from './exam-topic';

export const LAB_AGENT_ID = 'default-7';

type RunAgents =
  | { mode: 'auto'; presetAgentIds?: readonly string[] }
  | { mode: 'preset'; agentIds: readonly string[] };

/** Whether the learner's agent selection for a run includes the Lab agent. */
export function selectsLabAgent(agents: RunAgents | undefined): boolean {
  if (!agents) return false;
  const ids = agents.mode === 'preset' ? agents.agentIds : (agents.presetAgentIds ?? []);
  return ids.includes(LAB_AGENT_ID);
}

/** Whether a request is recognisably about an algorithm, data structure or programming. */
export function isLabTopic(requirement: string): boolean {
  const intent = courseIntent(requirement);
  return intent.programming || intent.explicitPractice || isExamAlgorithmTopic(requirement);
}
