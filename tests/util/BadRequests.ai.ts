/**
 * Client calls the task manager should reject, keyed by test case. Each is
 * the client method to call and the arguments to call it with.
 */
export interface ClientRequest {
  endpoint: "submitTask" | "getStatus" | "getProgram" | "getResults";
  args: unknown[];
}

/** A valid program, so each request only breaks the one field under test */
const COMMANDS = ["0 X forward"];
/** Valid format, but never stored since no program hashes to all zeros */
const UNKNOWN_PROGRAM_ID = "0".repeat(64);

export const BAD_REQUESTS = {
  submitBadIdemKey: { endpoint: "submitTask", args: [COMMANDS, 1, "bad"] },
  submitNoCommands: { endpoint: "submitTask", args: [[], 1] },
  submitTooManyCommands: {
    endpoint: "submitTask",
    args: [Array(1001).fill(COMMANDS[0]), 1],
  },
  submitBlankCommand: { endpoint: "submitTask", args: [[" "], 1] },
  submitLongCommand: { endpoint: "submitTask", args: [["x".repeat(65)], 1] },
  submitZeroRuns: { endpoint: "submitTask", args: [COMMANDS, 0] },
  submitTooManyRuns: { endpoint: "submitTask", args: [COMMANDS, 3001] },

  statusZeroTaskId: { endpoint: "getStatus", args: [0] },
  statusNonNumericTaskId: { endpoint: "getStatus", args: ["abc"] },
  statusUnknownTaskId: {
    endpoint: "getStatus",
    args: [Number.MAX_SAFE_INTEGER],
  },

  programBadProgramId: { endpoint: "getProgram", args: ["xyz"] },
  programUnknownProgramId: {
    endpoint: "getProgram",
    args: [UNKNOWN_PROGRAM_ID],
  },

  resultsBadProgramId: { endpoint: "getResults", args: ["xyz"] },
  resultsZeroTaskId: {
    endpoint: "getResults",
    args: [UNKNOWN_PROGRAM_ID, 0],
  },
  resultsNonNumericTaskId: {
    endpoint: "getResults",
    args: [UNKNOWN_PROGRAM_ID, "abc"],
  },
} satisfies Record<string, ClientRequest>;
