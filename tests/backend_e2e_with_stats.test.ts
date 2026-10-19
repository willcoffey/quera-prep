import { expect, test } from "vitest";
import { Client } from "../frontend/src/Client";
import { PROGRAMS } from "./util/programs.ai";
import { compareShots } from "./util/probabilities.ai";

const BASE_URL = "http://localhost:8000";
const RUNS = 3000;
/** Fail if results aren't computed in 30s */
const MAX_RUNTIME = 30000;

test("backend_e2e_with_stats", async () => {
  const start = Date.now();
  const client = new Client(() => {}, () => "", () => {}, BASE_URL);
  const programs = Object.values(PROGRAMS);
  const results: Record<string, number[]> = {};

  /** Submit all programs concurrently to the backend */
  const taskIds = await Promise.all(programs.map((p) => client.submitTask(p, RUNS)));

  /** Continously poll status for job completion */
  for (const taskId of taskIds) {
    while ((await client.getStatus(taskId)).complete < RUNS) {
      if (Date.now() - start > MAX_RUNTIME) throw new Error(`Task ${taskId} timed out`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** Load the shots for each program */
  /** @TODO - update api for per task results */
  for (const [name, program] of Object.entries(PROGRAMS)) {
    results[name] = (await client.getResults(await Client.programId(program))).results;
  }

  /** Compute the stats for backend shot results vs qc.ts */
  const stats = Object.entries(PROGRAMS).map(([name, program]) =>
    compareShots(results[name], program)
  );

  // Print the readable results to console
  printResults(stats, Date.now() - start);

  stats.forEach(({ maxError }, i) =>
    expect(maxError, `PROGRAM ${i + 1}`).toBeLessThanOrEqual(0.05)
  );
}, MAX_RUNTIME + 5000);

/** Prints one line per program, then the total runtime */
function printResults(stats: { shots: number; maxError: number }[], runtimeMs: number) {
  const lines = stats.map(({ shots, maxError }, i) =>
    `PROGRAM ${i + 1}   ${shots} shots   max error ${maxError.toFixed(3)}   ${
      maxError <= 0.05 ? "PASS" : "FAIL"
    }`
  );
  console.log([...lines, `Final runtime: ${(runtimeMs / 1000).toFixed(1)}s`].join("\n"));
}
