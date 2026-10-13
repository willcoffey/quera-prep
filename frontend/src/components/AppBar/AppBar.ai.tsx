import "./AppBar.ai.css";
import { memo, type ReactNode } from "react";
import type { DisplayOptions } from "../../App";
import type { CoreEvent } from "../../Core";
import { Screen } from "../Utility/Screen.ai";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { Grid2x2Icon, MenuIcon, MonitorCogIcon, PlayIcon } from "lucide-react";

interface AppBarProps {
  programId: string;
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
/** a single qubit gate on each qubit in turn, as map mode does */
const each = (gate: string, qs: number[]) =>
  qs.flatMap((q) => [select([q]), apply(gate)]);
const bits = (n: number, qs: number[], value: 0 | 1) =>
  qs.filter((q) => ((n >> q) & 1) === value);

/** Finds the marked world among 8. Answer: world 5. */
function grover(): CoreEvent[] {
  const qubits = [0, 1, 2];
  const zeros = bits(0b101, qubits, 0);
  const flipAllOnes = [select(qubits), apply("CCZ")];
  const oracle = [...each("X", zeros), ...flipAllOnes, ...each("X", zeros)];
  const diffusion = [
    ...each("Hadamard", qubits), ...each("X", qubits),
    ...flipAllOnes,
    ...each("X", qubits), ...each("Hadamard", qubits),
  ];
  // ⌊π/4 · √8⌋ = 2 rounds, ≈94.5% on the target
  const rounds = Array.from({ length: 2 }, () => [...oracle, ...diffusion]);
  return [...each("Hadamard", qubits), ...rounds.flat(), select([])];
}

/**
 * Recovers a hidden string s from one query of f(x) = s·x. The phase oracle
 * is Z on each qubit where s is 1. Answer: world s = 89.
 */
function bernsteinVazirani(): CoreEvent[] {
  const qubits = [0, 1, 2, 3, 4, 5, 6];
  const s = 0b1011001;
  return [
    ...each("Hadamard", qubits),
    ...each("Z", bits(s, qubits, 1)),
    ...each("Hadamard", qubits),
    select([]),
  ];
}

/**
 * Constant or balanced in one query. Balanced oracle f(x) = x0·x1 ⊕ x2 as
 * phases: CZ on 0, 1 and Z on 2. Answer: world 0 goes dark (4 worlds with
 * qubit 2 set light up); a constant f would leave world 0 lit.
 */
function deutschJozsa(): CoreEvent[] {
  const qubits = [0, 1, 2];
  return [
    ...each("Hadamard", qubits),
    select([0, 1]), apply("CZ"),
    ...each("Z", [2]),
    ...each("Hadamard", qubits),
    select([]),
  ];
}

/**
 * Sends 2 classical bits with 1 qubit of a shared Bell pair: Alice applies
 * Z for the high bit and X for the low bit to qubit 0; Bob decodes with
 * CNOT and H. Message 11, so qubits 0 and 1 end set. Answer: world 3.
 */
function superdenseCoding(): CoreEvent[] {
  return [
    ...each("Hadamard", [0]), select([0, 1]), apply("CNOT"), // shared pair
    ...each("X", [0]), ...each("Z", [0]),                     // encode 11
    select([0, 1]), apply("CNOT"), ...each("Hadamard", [0]),  // decode
    select([]),
  ];
}

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
 * Phase oracle interference: H on every qubit, a hypergraph phase oracle of
 * multi-controlled Zs, then H again. The oracle phases show as colour
 * mid-run; the final H layer turns them into the Walsh spectrum of the
 * Boolean function f(x) = x0..x4 ⊕ x3..x7 ⊕ x0·x7 ⊕ x1..x6.
 * Answer: worlds 0, 1, 128, 129 (~25/19/19/17%), 93 others faint, the
 * rest dark.
 */
function phaseOracle(): CoreEvent[] {
  const qubits = [0, 1, 2, 3, 4, 5, 6, 7];
  const terms = [[0, 1, 2, 3, 4], [3, 4, 5, 6, 7], [0, 7], [1, 2, 3, 4, 5, 6]];
  // k qubit controlled Z is named with k - 1 Cs, e.g. CCZ for 3
  const oracle = terms.flatMap((qs) =>
    [select(qs), apply("C".repeat(qs.length - 1) + "Z")]);
  return [
    ...each("Hadamard", qubits),
    ...oracle,
    ...each("Hadamard", qubits),
    select([]),
  ];
}

const SCRIPTS: Record<string, () => CoreEvent[]> = {
  "Phase oracle (8 qubits)": phaseOracle,
  "Grover search (3 qubits)": grover,
  "Bernstein–Vazirani (7 qubits)": bernsteinVazirani,
  "Deutsch–Jozsa (3 qubits)": deutschJozsa,
  "Superdense coding": superdenseCoding,
  "Random circuit (8 qubits)": randomCircuit,
};

const MENU_ITEMS = [...Object.keys(SCRIPTS), "Sed do eiusmod"];

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
  dispatch,
  displayOptions,
  setDisplayOptions,
}: AppBarProps) {
  return (
    <div className="AppBar">
      <Screen
        className="AppBar-programId"
        aria-label="Program ID"
        value={programId}
        placeholder="no program"
        mono
      />

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

      <Tip text="Run job">
        <Button
          className="AppBar-button"
          aria-label="Run job"
          onPress={() => dispatch({ action: "run-job", args: {} })}
        >
          <PlayIcon aria-hidden />
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
              // drops whatever is still queued on reset.
              SCRIPTS[String(key)]?.().forEach(dispatch);
            }}
          >
            {MENU_ITEMS.map((label) => (
              <MenuItem key={label} id={label} className="AppBar-menuItem">
                {label}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
});
