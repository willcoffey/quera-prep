import { expect, test } from "vitest";
import { Core } from "../frontend/src/Core";
import { Gates, QuantumComputer } from "../frontend/src/qc";
import { decode, layout, Renderer } from "../frontend/src/Renderer.ai";


/**
 * Ensures that data can be recovered from the rendered output by reversing the
 * amplitude -> color function
 */
test("palette_test", async () => {
  const FLOOR = 2 ** -8.5; // brightness floor for 8 qubits
  const v = new Float64Array(512).map(() => Math.random() * 2 - 1);
  let total = 0;
  for (const x of v) total += x * x;

  const r = new Renderer(8);
  r.resize(256, 256); // 16 px per cell, so centers clear the grid lines
  r.push({ data: v });
  const frames = r[Symbol.asyncIterator]();
  const { value: frame } = await frames.next();
  const out = recoverFloatArray(frame!, r.width, r.height);

  for (let i = 0; i < 256; i++) {
    const p = (v[2 * i] ** 2 + v[2 * i + 1] ** 2) / total;
    const recovered = out[2 * i] ** 2 + out[2 * i + 1] ** 2;
    expect(Math.abs(Math.log2(recovered / Math.max(p, FLOOR)))).toBeLessThan(0.05);
    if (p < FLOOR) continue; // phase only shows above the floor
    const dPhase = Math.atan2(out[2 * i + 1], out[2 * i]) - Math.atan2(v[2 * i + 1], v[2 * i]);
    expect(Math.abs(Math.atan2(Math.sin(dPhase), Math.cos(dPhase)))).toBeLessThan(0.1);
  }
});


/**
 * End-to-end test of core to run a large number of gates and recover the
 * value from every rendered frame, through each partition layout.
 */
test("state_recover_e2e_test", async () => {
  /** create core and quantum comptuer instance. get them setup */
  const { core, frames } = await simpleCore();
  const drain = drainer(frames);
  const qc = new QuantumComputer(8);
  const seed = Date.now();
  const random = mulberry32(seed);

  /** Generate a list of random ops to run on both */
  const gates = [["Hadamard", 1], ["T", 1], ["CNOT", 2], ["CZ", 2], ["SWAP", 2], ["CCNOT", 3]] as const;
  const ops = Array.from({ length: 40 }, () => {
    const [gate, arity] = gates[Math.floor(random() * gates.length)];
    return { gate, qubits: [0, 1, 2, 3, 4, 5, 6, 7].sort(() => random() - 0.5).slice(0, arity) };
  });

  /** Send the same op to both, checking the frame after the select and gate */
  for (const { gate, qubits } of ops) {
    core.dispatch({ action: "select-qubits", args: { qubits } });
    await core.eventChain.chain;
    await drain();
    expectFrame(core.renderer, qubits, qc.worlds, seed);

    core.dispatch({ action: "apply-gate", args: { gate } });
    qc.applyGate(qubits, Gates[gate].forward);
    await core.eventChain.chain;
    await drain();
    expectFrame(core.renderer, qubits, qc.worlds, seed);
  }
});

/** The renderer's frame, in the layout for `selection`, shows state `v` */
function expectFrame(r: Renderer, selection: number[], v: Float64Array, seed: number) {
  const FLOOR = 2 ** -8.5; // brightness floor for 8 qubits
  const out = recoverFloatArray(r.frame, r.width, r.height, selection);
  for (let i = 0; i < 256; i++) {
    const p = v[2 * i] ** 2 + v[2 * i + 1] ** 2; // unitary from |0>, so normalized
    const recovered = out[2 * i] ** 2 + out[2 * i + 1] ** 2;
    const dP = Math.log2(Math.max(recovered, FLOOR) / Math.max(p, FLOOR));
    expect(Math.abs(dP), `seed ${seed}`).toBeLessThan(0.05);
    if (p < FLOOR) continue; // phase only shows above the floor
    const dPhase = Math.atan2(out[2 * i + 1], out[2 * i]) - Math.atan2(v[2 * i + 1], v[2 * i]);
    expect(Math.abs(Math.atan2(Math.sin(dPhase), Math.cos(dPhase))), `seed ${seed}`).toBeLessThan(0.1);
  }
}

/**
 * Pulls frames until the queue is empty. The pull left waiting carries over
 * to the next call: an abandoned next() would swallow the following frame.
 */
function drainer(frames: AsyncIterator<Uint8ClampedArray>) {
  let pending = frames.next();
  return async () => {
    // An empty queue leaves next() pending, so a macrotask wins the race
    while (await Promise.race([pending, new Promise<void>((r) => setTimeout(r))])) {
      pending = frames.next();
    }
  };
}


/** Seeded random, so a failure can be replayed from the seed it reports */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Interleaved re/im amplitudes a width x height frame shows, sampled at the
 * center pixel of each cell, at rest in the layout for `selection`. Relative
 * to the total like the state it came from, and lossy below the brightness
 * floor. Cells must be big enough that grid lines miss their centers.
 */
function recoverFloatArray(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  selection: number[] = [],
  qubits = 8,
) {
  const { grid, pos } = layout(selection, qubits);
  // Cell edges snapped to whole pixels, as Renderer draws them
  const x = (col: number) => Math.round(col * width / grid.cols);
  const y = (row: number) => Math.round(row * height / grid.rows);
  const out = new Float64Array(2 * grid.size);
  for (let i = 0; i < grid.size; i++) {
    const row = pos[2 * i], col = pos[2 * i + 1];
    const cx = (x(col) + x(col + 1)) >> 1;
    const cy = (y(row) + y(row + 1)) >> 1;
    const at = 4 * (cy * width + cx);
    const { p, phase } = decode(frame[at], frame[at + 1], frame[at + 2], qubits);
    out[2 * i] = Math.sqrt(p) * Math.cos(phase);
    out[2 * i + 1] = Math.sqrt(p) * Math.sin(phase);
  }
  return out;
}

/** Core at speed 0. Setup frames are already pulled. */
async function simpleCore() {
  const core = new Core();
  core.state.animationSpeed = 0;
  const frames = core.renderer[Symbol.asyncIterator]();
  await frames.next(); // Core's initial data
  return { core, frames };
}
