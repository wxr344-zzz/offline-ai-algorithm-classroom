import type { GuidedLabScene, OJLabScene, JsonValue } from './eduplus.generated';

export type LabScene = GuidedLabScene | OJLabScene;
export interface StudentDraft {
  sceneId: string;
  problemVersion: number;
  code: string;
  revision: number;
  updatedAt: string | null;
}
export interface SaveDraftRequest {
  problemVersion: number;
  code: string;
  revision: number;
}
export interface PracticeCaseResult {
  caseId: string;
  passed: boolean;
  /** Compatibility field: completed strict judgements always set this to true. */
  verified?: boolean;
  verdict?: 'Accepted' | 'Wrong Answer' | 'Runtime Error' | 'Time Limit Exceeded';
  actual?: JsonValue;
  error?: string;
}
export interface PracticeResult {
  cases: PracticeCaseResult[];
  output: string;
}
