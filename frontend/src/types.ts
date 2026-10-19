/**
 * API Response Types
 */
export interface APIResponse<T> {
  msg: string;
  data: T;
}
/** POST /tasks/ */
export interface TaskIdData {
  taskId: number;
}
/** GET /tasks/{taskId}/status */
export interface TaskStatusData {
  taskId: number;
  requested: number;
  complete: number;
  failed: number;
}
/** GET /tasks/programs/{programId} */
export interface ProgramData {
  programId: string;
  commands: string[];
}
/** GET /tasks/results/{programId} */
export interface RunResultsData {
  programId: string;
  results: number[];
}

/**
 * API Request Bodies
 */
/** POST /tasks/ */
export interface CreateTaskBody {
  /** /[A-Za-z0-9]{64}/ */
  idemKey: string;
  /** SHA256 of NSV UTF-8 encoded commands. /[0-9a-f]{64}/ */
  programId: string;
  /** 1-1000 gate command strings, each <= 64 chars */
  commands: string[];
  /** 1-500 */
  runs: number;
}

