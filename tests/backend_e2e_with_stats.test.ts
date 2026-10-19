import { expect, test } from "vitest";
import { Client } from "../frontend/src/Client";
import { Program, PROGRAMS } from "./util/programs.ai";
import { compareShots } from "./util/probabilities.ai";

const BASE_URL = "http://localhost:8000";
const RUNS = 3000;
const MAX_RUNTIME = 30000;

/**
 * Runs the test with a 30s limit to complete all of them.
 */
test(
  "backend_e2e_with_stats",
  async () => {
    const start = Date.now();
    const client = new Client(() => {}, () => "", () => {}, BASE_URL);
    /** Submit all programs concurrently to the backend */
    const submitted: SubmittedProgram[] = await Promise.all(
      PROGRAMS.map(async (p) => (
        { ...p, taskId: await client.submitTask(p.commands, RUNS) }
      )),
    );

    /** Continously poll status for job completion */
    for (const { taskId } of submitted) {
      while ((await client.getStatus(taskId)).complete < RUNS) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    /** Load the shots for each program */
    const completed: CompletedProgram[] = await Promise.all(
      submitted.map(async (p) => ({
        ...p,
        results: (await client.getResults(await Client.programId(p.commands), p.taskId)).results,
      })),
    );

    /** Compute the stats for backend shot results vs qc.ts */
    const stats = completed.map((p) => compareShots(p.results, p.commands));

    // Print the readable results to console
    printResults(stats, Date.now() - start);

    // Throw if stats is above the max error
    stats.forEach(({ maxError }, i) =>
      expect(maxError, `PROGRAM ${i + 1}`).toBeLessThanOrEqual(0.05)
    );
  },
  MAX_RUNTIME,
);

/** Prints one line per program, then the total runtime */
function printResults(stats: { shots: number; maxError: number }[], runtimeMs: number) {
  const lines = stats.map(({ shots, maxError }, i) =>
    `PROGRAM ${i + 1}   ${shots} shots   max error ${maxError.toFixed(3)}   ${
      maxError <= 0.05 ? "PASS" : "FAIL"
    }`
  );
  console.log([...lines, `Final runtime: ${(runtimeMs / 1000).toFixed(1)}s`].join("\n"));
}

interface SubmittedProgram extends Program {
  taskId: number;
}
interface CompletedProgram extends SubmittedProgram {
  results: number[];
}
