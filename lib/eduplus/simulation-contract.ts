/** Data-only snapshots produced by maintained Python executors. */
export interface SimulationReference {
  topic: string;
  input?: Record<string, unknown>;
  courseId?: string;
  mode?: 'simulation' | 'game';
}
export interface SimulationProfile {
  id: string;
  title: string;
  aliases: string[];
  section: string;
  default: Record<string, unknown>;
}
export type TraceValue =
  | null
  | boolean
  | number
  | string
  | TraceValue[]
  | { [key: string]: TraceValue };
export interface TraceNode {
  id: string;
  label: string;
  mark?: string;
  color?: string;
}
export interface TraceEdge {
  source: string;
  target: string;
  label?: string;
  kind?: string;
  directed?: boolean;
  mark?: string;
}
export type TraceView =
  | {
      kind: 'sequence';
      name: string;
      values: TraceValue[];
      pointers: Record<string, number>;
      active: number[];
    }
  | {
      kind: 'matrix';
      name: string;
      values: TraceValue[][];
      rows: TraceValue[];
      columns: TraceValue[];
      active: number[][];
      dependencies: number[][];
    }
  | { kind: 'containers'; name: string; groups: { name: string; values: TraceValue[] }[] }
  | { kind: 'table'; name: string; columns: string[]; rows: TraceValue[][]; active: number[] }
  | {
      kind: 'tree' | 'graph';
      name: string;
      nodes: TraceNode[];
      edges: TraceEdge[];
      roots?: string[];
    };
export interface SimulationTrace {
  version: 1;
  engine: 'python-deterministic' | 'python-sandbox';
  inputDescription?: string;
  verification?: {
    kind: 'execution-crosscheck';
    sourceHash: string;
    checkedInputs: number;
    deterministicReplay: boolean;
    snapshots: 'python-line-trace';
  };
  algorithm: string;
  title: string;
  input: Record<string, unknown>;
  frames: {
    index: number;
    label: string;
    explanation: string;
    views: TraceView[];
    state: Record<string, TraceValue>;
  }[];
  outcome: TraceValue;
  verified: boolean;
}
