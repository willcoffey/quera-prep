import { describe, expect, test } from "vitest";
import { Client, ClientError } from "../frontend/src/Client";
import { BAD_REQUESTS, ClientRequest } from "./util/BadRequests.ai";

const BASE_URL = "http://localhost:8000";
const client = new Client(() => {}, () => "", () => {}, BASE_URL);

describe("error_paths", () => {
  test(
    "400 - submit, idemKey not 64 alphanumeric chars",
    testReq(400, BAD_REQUESTS.submitBadIdemKey),
  );
  test("400 - submit, no commands", testReq(400, BAD_REQUESTS.submitNoCommands));
  test("400 - submit, over 1000 commands", testReq(400, BAD_REQUESTS.submitTooManyCommands));
  test("400 - submit, blank command", testReq(400, BAD_REQUESTS.submitBlankCommand));
  test("400 - submit, command over 64 chars", testReq(400, BAD_REQUESTS.submitLongCommand));
  test("400 - submit, zero runs", testReq(400, BAD_REQUESTS.submitZeroRuns));
  test("400 - submit, over 3000 runs", testReq(400, BAD_REQUESTS.submitTooManyRuns));
  test("400 - status, taskId zero", testReq(400, BAD_REQUESTS.statusZeroTaskId));
  test("400 - status, taskId not a number", testReq(400, BAD_REQUESTS.statusNonNumericTaskId));
  test("404 - status, taskId doesn't exist", testReq(404, BAD_REQUESTS.statusUnknownTaskId));
  test("400 - program, programId not 64 hex chars", testReq(400, BAD_REQUESTS.programBadProgramId));
  test(
    "404 - program, programId doesn't exist",
    testReq(404, BAD_REQUESTS.programUnknownProgramId),
  );
  test("400 - results, programId not 64 hex chars", testReq(400, BAD_REQUESTS.resultsBadProgramId));
  test("400 - results, taskId zero", testReq(400, BAD_REQUESTS.resultsZeroTaskId));
  test("400 - results, taskId not a number", testReq(400, BAD_REQUESTS.resultsNonNumericTaskId));

  /** Don't use Client or require multiple requests */
  test("400 - submit, bad or mismatched programId", testBadProgramId());
  test("409 - submit, idemKey reused for another program", testIdemKey());
});

/**
 * Returns an async function that runs the request and throws if it doesn't
 * respond with the expected error status
 */
function testReq(expectedStatus: number, { endpoint, args }: ClientRequest) {
  if (!(endpoint in client)) throw new Error(`Client has no method ${endpoint}`);
  const method: Function = client[endpoint];
  return async () => {
    try {
      await method.apply(client, args);
    } catch (error) {
      if (!(error instanceof ClientError)) throw error;
      expect(error.status).toBe(expectedStatus);
      return;
    }
    expect.fail(`Expected ${expectedStatus}, but the request succeeded`);
  };
}

/**
 * Helper functions for tests not compatible with client, or that need multiple
 * requests
 */

/**
 * Client always generates the programId from the program. manually submit
 * some bad ones.
 *
 * tests invalid key and sha mismatch
 */
function testBadProgramId() {
  return async () => {
    for (const programId of ["xyz", "0".repeat(64)]) {
      const res = await fetch(`${BASE_URL}/tasks/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idemKey: Client.idemKey(),
          programId,
          commands: ["0 X forward"],
          runs: 1,
        }),
      });
      expect(res.status, `programId ${programId}`).toBe(400);
    }
  };
}

/**
 * Testing the idemKey handling requires multiple request
 * Submits a task, then reuses its idemKey for a different program
 */
function testIdemKey() {
  return async () => {
    const idemKey = Client.idemKey();
    await client.submitTask(["0 X forward"], 1, idemKey);

    const reuse: ClientRequest = {
      endpoint: "submitTask",
      args: [["1 X forward"], 1, idemKey],
    };
    await testReq(409, reuse)();
  };
}

