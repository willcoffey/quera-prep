import "./AppBar.ai.css";
import { memo, type ReactNode } from "react";
import type { DisplayOptions } from "../../App";
import { ANIMATION_SPEEDS, type CoreEvent } from "../../Core";
import { Screen } from "../Utility/Screen.ai";
import {
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import {
  CloudDownloadIcon,
  CloudUploadIcon,
  Grid2x2Icon,
  InfinityIcon,
  MenuIcon,
  MonitorCogIcon,
} from "lucide-react";

interface AppBarProps {
  programId: string;
  /** ms per gate/selection from Core; 0 is instant */
  animationSpeed: number;
  /** Client is fetching results; pulses the results key */
  polling: boolean;
  dispatch: (event: CoreEvent) => void;
  displayOptions: DisplayOptions;
  setDisplayOptions: (displayOptions: DisplayOptions) => void;
}

/*
 * Toy algorithms as the select + apply events the keypad would send. Each
 * assumes its qubits start at |0⟩ and ends with no selection, so answers
 * show at their natural grid index (world w: row w >> 4, column w & 15).
 */
const select = (qs: number[]): CoreEvent =>
  ({ action: "select-qubits", args: { qubits: qs } });
const apply = (gate: string): CoreEvent =>
  ({ action: "apply-gate", args: { gate } });
const invert = (gate: string): CoreEvent =>
  ({ action: "apply-gate", args: { gate, inverse: true } });
/** a single qubit gate on each qubit at once, as map mode does. No qubits
    is nothing: map with an empty selection would hit all 8 */
const each = (gate: string, qs: number[]): CoreEvent[] =>
  qs.length
    ? [select(qs), { action: "map-gate", args: { gate } }]
    : [];
const bits = (n: number, qs: number[], value: 0 | 1) =>
  qs.filter((q) => ((n >> q) & 1) === value);

/**
 * Random circuit sampling, as in Google's supremacy experiment: brickwork
 * layers of a random single qubit gate on every qubit, then CZ on
 * alternating neighbour pairs. T makes it non-Clifford, so magnitudes spread
 * to a speckle (Porter–Thomas) rather than staying flat. Every layer needs
 * an H: T and CZ are both diagonal, so layers of T alone barely mix and
 * leave whole regions dark. Fixed seed, so it replays the same.
 * Answer: chaos.
 */
function randomCircuit(): CoreEvent[] {
  const qubits = [0, 1, 2, 3, 4, 5, 6, 7];
  const random = mulberry32(0x5eed);
  // TH or HT, at random
  const mix = (q: number) =>
    [select([q]), ...(random() < 0.5 ? ["T", "Hadamard"] : ["Hadamard", "T"])
      .map(apply)];
  const layer = (depth: number) => [
    ...qubits.flatMap(mix),
    ...qubits
      .filter((q) => q % 2 === depth % 2 && q + 1 < qubits.length)
      .flatMap((q) => [select([q, q + 1]), apply("CZ")]),
  ];
  // 6 layers: Porter–Thomas speckle in simulation; 5 still leaves dark
  // patches for some seeds
  const layers = Array.from({ length: 6 }, (_, d) => layer(d));
  return [...each("Hadamard", qubits), ...layers.flat(), select([])];
}

/** Small seeded PRNG, uniform in [0, 1) */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Inverse QFT on a counting register, its bit j on qubits[j]: SWAPs reverse
 * the bit order, then each pair undoes a π/2^d phase, CS† (CT† twice) for
 * d = 1 and CT† for d = 2. Finer rotations (d ≥ 3) have no gate, so they're
 * dropped; exact for Shor here, as the period divides 2^n, so the output
 * bits controlling them are always 0.
 */
function inverseQft(qubits: number[]): CoreEvent[] {
  const n = qubits.length;
  const swaps = qubits.slice(0, n >> 1)
    .flatMap((q, i) => [select([q, qubits[n - 1 - i]]), apply("SWAP")]);
  const layers = qubits.flatMap((target, j) => [
    ...qubits.slice(0, j).flatMap((control, k) => {
      const d = j - k;
      if (d > 2) return [];
      return [select([control, target]), ...Array(3 - d).fill(invert("CT"))];
    }),
    select([target]), apply("Hadamard"),
  ]);
  return [...swaps, ...layers];
}

/**
 * Shor's period finding for 15 with base 2. Work register q0–q3 (the grid
 * column) starts at 1; counting register q4–q7 (the row) in superposition.
 * Counting bit 0 multiplies by 2 mod 15, a left rotation of the work bits
 * as 3 CSWAPs; bit 1 by 4, a rotation by 2; bits 2 and 3 by 16 ≡ 1, so
 * nothing. Answer: rows 0, 4, 8, 12 by columns 1, 2, 4, 8 (the powers of 2),
 * 1/16 each. Rows are multiples of 16/4, so the period is 4, and
 * gcd(2² ± 1, 15) gives 3 and 5.
 */
function shor15(): CoreEvent[] {
  const count = [4, 5, 6, 7];
  const cswap = (control: number, a: number, b: number) =>
    [select([control, a, b]), apply("CSWAP")];
  return [
    ...each("X", [0]),
    ...each("Hadamard", count),
    ...cswap(4, 2, 3), ...cswap(4, 1, 2), ...cswap(4, 0, 1),
    ...cswap(5, 0, 2), ...cswap(5, 1, 3),
    ...inverseQft(count),
    select([]),
  ];
}

/**
 * Shor's period finding for 35 with base 6. Work register q0–q5 starts at 1;
 * counting register q6–q7. 6² = 36 ≡ 1, so the work only ever holds 1 or 6,
 * and multiplying by 6 is flipping bits 0–2 (CNOTs). Picking a base of
 * period 2 already takes knowing the factors: a compiled demo, as published
 * small Shor experiments are. Answer: worlds 1, 6, 129, 134, 1/4 each; with
 * q7 set (129, 134) the period is 2, and gcd(6 ± 1, 35) gives 7 and 5.
 */
function shor35(): CoreEvent[] {
  const count = [6, 7];
  return [
    ...each("X", [0]),
    ...each("Hadamard", count),
    ...[0, 1, 2].flatMap((q) => [select([6, q]), apply("CNOT")]),
    ...inverseQft(count),
    select([]),
  ];
}

/** X on the last qubit where the rest are set: CNOT, CCNOT, … */
const cx = (qs: number[]) =>
  [select(qs), apply(`${"C".repeat(qs.length - 1)}NOT`)];
/** Z on the worlds where every qubit is set: Z, CZ, CCZ, … */
const cz = (qs: number[]) =>
  [select(qs), apply(qs.length > 1 ? `${"C".repeat(qs.length - 1)}Z` : "Z")];

/** Adds 1 to a register (low bit first) where every control is set: each
    bit flips when all bits below it are 1, top bit first. */
const increment = (reg: number[], controls: number[]) =>
  reg.map((_, j) => reg.length - 1 - j)
    .flatMap((j) => cx([...controls, ...reg.slice(0, j), reg[j]]));
/** Subtracts 1: increments the complement */
const decrement = (reg: number[], controls: number[]) =>
  [...each("X", reg), ...increment(reg, controls), ...each("X", reg)];

/**
 * 2D quantum walk on an 8×8 torus: x on q0–q2, y on q4–q6, a 2 qubit coin
 * on q3 and q7. Each step flips the coin (Grover diffusion) then moves one
 * square its way, by multi-controlled increments. Starts at (4, 4). The coin
 * bits split the grid into 4 tinted copies of the board. Answer: after 4
 * steps a checkerboard diamond, 64 worlds; interference holds ~39% at the
 * start, where a classical walk spreads into a smooth hump.
 */
function quantumWalk(): CoreEvent[] {
  const x = [0, 1, 2];
  const y = [4, 5, 6];
  const coin = [3, 7];
  const flip = [
    ...each("Hadamard", coin), ...each("X", coin), ...cz(coin),
    ...each("X", coin), ...each("Hadamard", coin),
  ];
  // moves where the coin reads c0 c1: 00 right, 10 left, 01 down, 11 up
  const when = (c0: 0 | 1, c1: 0 | 1, moves: CoreEvent[]) => {
    const zeros = coin.filter((_, i) => [c0, c1][i] === 0);
    return [...each("X", zeros), ...moves, ...each("X", zeros)];
  };
  const step = [
    ...flip,
    ...when(0, 0, increment(x, coin)), ...when(1, 0, decrement(x, coin)),
    ...when(0, 1, increment(y, coin)), ...when(1, 1, decrement(y, coin)),
  ];
  return [
    ...each("X", [2, 6]),
    // symmetric coin |−−⟩, so the walk spreads evenly
    ...each("X", coin), ...each("Hadamard", coin),
    ...Array.from({ length: 4 }, () => step).flat(),
    select([]),
  ];
}

/**
 * Grover over all 256 worlds, 4 marked: the 2×2 block at rows 10–11,
 * columns 6–7, so q0 and q4 are free and the oracle is one 6 qubit Z.
 * Diffusion uses the full 8 qubit Z. ⌊π/4 · √(256/4)⌋ = 6 rounds.
 * Answer: the 4 block worlds, ~25% each (99.6% together).
 */
function grover8(): CoreEvent[] {
  const qubits = [0, 1, 2, 3, 4, 5, 6, 7];
  const fixed = [1, 2, 3, 5, 6, 7];
  const zeros = bits(0b10100110, fixed, 0);
  const oracle = [...each("X", zeros), ...cz(fixed), ...each("X", zeros)];
  const diffusion = [
    ...each("Hadamard", qubits), ...each("X", qubits), ...cz(qubits),
    ...each("X", qubits), ...each("Hadamard", qubits),
  ];
  const rounds = Array.from({ length: 6 }, () => [...oracle, ...diffusion]);
  return [...each("Hadamard", qubits), ...rounds.flat(), select([])];
}

/**
 * Simon's: a hidden s with f(x) = f(x ⊕ s). Input x on q4–q7 (the row),
 * f(x) on q0–q3 (the column): copy x, then fold by s with CNOTs from one of
 * its set bits. Answer: s = 1011, so only the 8 rows y with y·s even light
 * up (0, 3, 4, 7, 9, 10, 13, 14), 8 columns each; a few rows solve for s.
 */
function simon(): CoreEvent[] {
  const input = [4, 5, 6, 7];
  const output = [0, 1, 2, 3];
  const s = [0, 1, 3]; // set bits of 1011
  return [
    ...each("Hadamard", input),
    ...input.flatMap((q, i) => cx([q, output[i]])),
    ...s.flatMap((i) => cx([input[s[0]], output[i]])),
    ...each("Hadamard", input),
    select([]),
  ];
}

const SCRIPTS: Record<string, () => CoreEvent[]> = {
  "Factor 15, Shor (8 qubits)": shor15,
  "Factor 35, Shor (8 qubits)": shor35,
  "Quantum walk (8 qubits)": quantumWalk,
  "Grover, 4 of 256 (8 qubits)": grover8,
  "Simon's (8 qubits)": simon,
  "Random circuit (8 qubits)": randomCircuit,
};

const MENU_ITEMS = Object.keys(SCRIPTS);

// 1x is Core's default speed (index 1); slower settings are longer durations
const BASE_SPEED = ANIMATION_SPEEDS[1];

/** e.g. 1000 → ".5×", 500 → "1×", 250 → "2×"; 0 (instant) → "∞" */
function speedLabel(ms: number) {
  if (!ms) return "∞";
  return `${+(BASE_SPEED / ms).toFixed(2)}×`.replace(/^0\./, ".");
}

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={500}>
      {children}
      <Tooltip className="AppBar-tooltip" offset={6}>
        {text}
      </Tooltip>
    </TooltipTrigger>
  );
}

// memo: skips the parent's re-renders while props are unchanged
export const AppBar = memo(function AppBar({
  programId,
  animationSpeed,
  polling,
  dispatch,
  displayOptions,
  setDisplayOptions,
}: AppBarProps) {
  return (
    <div className="AppBar">
      <Tip text="Grid lines">
        <ToggleButton
          className="AppBar-button AppBar-toggle"
          aria-label="Grid lines"
          isSelected={displayOptions.gridLines}
          onChange={(gridLines) =>
            setDisplayOptions({ ...displayOptions, gridLines })
          }
        >
          <Grid2x2Icon aria-hidden />
        </ToggleButton>
      </Tip>

      <Tip text="Simulation results">
        <ToggleButton
          className="AppBar-button AppBar-toggle"
          aria-label="Simulation results"
          isSelected={displayOptions.showResults}
          onChange={(showResults) => {
            setDisplayOptions({ ...displayOptions, showResults });
            // Turning results on refreshes them for the current program
            if (showResults) dispatch({ action: "fetch-results", args: {} });
          }}
        >
          <MonitorCogIcon aria-hidden />
        </ToggleButton>
      </Tip>

      <Tip text="Animation speed">
        <Button
          className="AppBar-button AppBar-speed"
          aria-label={`Animation speed ${speedLabel(animationSpeed)}`}
          onPress={() => dispatch({ action: "cycle-speed", args: {} })}
        >
          {animationSpeed ? speedLabel(animationSpeed) : <InfinityIcon aria-hidden />}
        </Button>
      </Tip>

      {/* Display controls left of the id, backend (job) controls right */}
      <Screen
        className="AppBar-programId"
        aria-label="Program ID"
        value={programId}
        placeholder="N/A"
        mono
      />

      <Tip text="Submit to Server">
        <Button
          className="AppBar-button"
          aria-label="Submit to Server"
          // Nothing to submit until a gate has been applied
          isDisabled={!programId}
          onPress={() => dispatch({ action: "run-job", args: {} })}
        >
          <CloudUploadIcon aria-hidden />
        </Button>
      </Tip>

      <Tip text={polling ? "Pulling simulation results" : "Pull simulation results"}>
        <Button
          className="AppBar-button AppBar-pull"
          aria-label="Pull simulation results"
          data-polling={polling || undefined}
          // No results to pull until a gate has been applied
          isDisabled={!programId}
          onPress={() => dispatch({ action: "fetch-results", args: {} })}
        >
          <CloudDownloadIcon aria-hidden />
        </Button>
      </Tip>

      <MenuTrigger>
        <Tip text="Menu">
          <Button className="AppBar-button" aria-label="Menu">
            <MenuIcon aria-hidden />
          </Button>
        </Tip>
        <Popover className="AppBar-popover" placement="bottom end">
          <Menu
            className="AppBar-menu"
            onAction={(key) => {
              // Core queues events on its gate chain, which paces them and
              // drops whatever is still queued on reset. Scripts assume
              // |0⟩, so AC first: clears the state and any running script.
              const script = SCRIPTS[String(key)];
              if (!script) return;
              dispatch({ action: "reset", args: {} });
              script().forEach(dispatch);
            }}
          >
            <MenuSection>
              <Header className="AppBar-menuHeader">AI Generated</Header>
              {MENU_ITEMS.map((label) => (
                <MenuItem key={label} id={label} className="AppBar-menuItem">
                  {label}
                </MenuItem>
              ))}
            </MenuSection>
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
});
