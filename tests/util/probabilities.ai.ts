/**
 * Compares backend shots against qc.ts, using the same check as qiskit-aer's
 * own tests.
 *
 * qiskit-aer tests non-deterministic circuits with
 *   shots = 4000
 *   self.compare_counts(result, circuits, targets, delta=0.05 * shots)
 * https://github.com/Qiskit/qiskit-aer/blob/main/test/terra/backends/aer_simulator/test_cliffords.py
 *
 * compare_counts calls QiskitAerTestCase.assertDictAlmostEqual, which
 *  - compares every key in either dict, a missing key counting as 0
 *  - fails when abs(val1 - val2) > delta
 * https://github.com/Qiskit/qiskit-aer/blob/main/test/terra/common.py
 *
 * compareShots matches that exactly. Every one of the 256 outcomes is
 * compared, a superset of the union of keys where the extra outcomes are 0 on
 * both sides. maxError is the largest abs(count / shots - p), so
 * maxError <= 0.05 is the same as abs(count - p * shots) <= 0.05 * shots for
 * every outcome.
 *
 * Verified 2026-10-19 by reading compare_counts and assertDictAlmostEqual in
 * common.py, and test_h_gate_nondeterministic in test_cliffords.py, on
 * qiskit-aer main. Aer uses delta=0 for deterministic circuits, which this
 * does not do.
 */
import { Gates, QuantumComputer } from "../../frontend/src/qc";

/**
 * Largest difference between an outcome's shot frequency and its qc.ts
 * probability, and which outcome it was
 */
export function compareShots(shots: number[], program: string[]) {
  const p = probabilities(program);
  const counts = new Array(256).fill(0);
  for (const s of shots) counts[s]++;

  let maxError = 0, outcome = 0;
  for (let i = 0; i < 256; i++) {
    const error = Math.abs(counts[i] / shots.length - p[i]);
    if (error > maxError) (maxError = error), (outcome = i);
  }
  return { shots: shots.length, maxError, outcome };
}

/** Probability of each of the 256 outcomes after running `program` in qc.ts */
function probabilities(program: string[]): number[] {
  const qc = new QuantumComputer(8);
  for (const command of program) {
    const parts = command.split(" ");
    const direction = parts.pop() as "forward" | "reverse";
    const gate = parts.pop()!;
    qc.applyGate(parts.map(Number), Gates[gate][direction]);
  }
  return Array.from({ length: 256 }, (_, i) => qc.worlds[2 * i] ** 2 + qc.worlds[2 * i + 1] ** 2);
}
