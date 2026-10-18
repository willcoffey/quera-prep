import "./Keyboard.ai.css";
import { memo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Button,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import type { CoreEvent } from "../../Core";
import { Screen } from "../Utility/Screen.ai";

interface KeyboardProps {
  selectedQubits: number[];
  /** most recent gate and the qubits it hit, in selection order */
  lastInstruction?: { ins: { gate: string; inverse?: boolean }; qubits: number[] };
  dispatch: (event: CoreEvent) => void;
}

interface Gate {
  /** gate name sent to Core */
  id: string;
  /** at most 2 characters; full name is in the tooltip */
  label: string;
  /** spoken / tooltip name */
  name: string;
  /** gate is its own inverse, so inverse mode leaves it unchanged */
  selfInverse?: boolean;
}

/** Map with nothing selected applies to every qubit. Matches Core. */
const QUBITS = [0, 1, 2, 3, 4, 5, 6, 7];
/** Gate area: under Q0–Q5, left of the controls */
const GATE_COLS = 6;
const GATE_ROWS = 2;

/** Only the gates the simulator implements; ids are its `Gates` keys.
    H, T and CNOT are a universal set. */
const SINGLE_QUBIT: Gate[] = [
  { id: "Hadamard", label: "H", name: "Hadamard", selfInverse: true },
  { id: "T", label: "T", name: "T" },
  { id: "X", label: "X", name: "Pauli X (NOT)", selfInverse: true },
  { id: "Z", label: "Z", name: "Pauli Z", selfInverse: true },
];

/** Controlled families: controls first, target(s) last, in selection
    order. Ids follow the simulator, one C per control: CNOT, CCNOT, …;
    CZ, CCZ, …; CT, CCT, …; SWAP, CSWAP, … (SWAP has 2 targets, so it needs
    no control). "⇄" is a single character, keeping "•⇄" to 2. */
const FAMILIES = [
  { symbol: "X", name: "X", targets: 1, suffix: "NOT", selfInverse: true },
  { symbol: "Z", name: "Z", targets: 1, suffix: "Z", selfInverse: true },
  { symbol: "T", name: "T", targets: 1, suffix: "T", selfInverse: false },
  { symbol: "⇄", name: "swap", targets: 2, suffix: "SWAP", selfInverse: true },
];

/** Well known names, added to the tooltip */
const AKA: Record<string, string> = { CCNOT: "Toffoli", CSWAP: "Fredkin" };

/** Control count as a label prefix: "•" and "‥" (single characters, keeping
    the label to 2), then a superscript count ("³Z"). */
function controlMark(controls: number) {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return ["", "•", "‥"][controls]
    ?? String(controls).replace(/\d/g, (d) => digits[Number(d)]);
}

function controlName(controls: number) {
  return ["", "Controlled ", "Doubly controlled "][controls]
    ?? `${controls} controlled `;
}

/** The family gates that take exactly n ≥ 2 qubits */
function multiQubit(n: number): Gate[] {
  return FAMILIES.filter((f) => n >= Math.max(2, f.targets)).map((f) => {
    const controls = n - f.targets;
    const id = "C".repeat(controls) + f.suffix;
    const name = controls ? controlName(controls) + f.name : "Swap";
    return {
      id,
      label: controlMark(controls) + f.symbol,
      name: AKA[id] ? `${name} (${AKA[id]})` : name,
      selfInverse: f.selfInverse,
    };
  });
}

/** Short text for the Last screen: key label, † when inverse, then the
    qubits in order (controls first), e.g. "•X 10", "T† 3". Qubits are
    single digits, so no separator; worst case "⁷Z 01234567" fits half the
    keyboard on a small phone, spaced it wouldn't. */
function describe({ ins, qubits }: NonNullable<KeyboardProps["lastInstruction"]>) {
  const gate = [...SINGLE_QUBIT, ...multiQubit(qubits.length || QUBITS.length)]
    .find((g) => g.id === ins.gate);
  const label = (gate?.label ?? ins.gate) + (ins.inverse ? "†" : "");
  // No selection means every qubit, as in Core
  return `${label} ${(qubits.length ? qubits : QUBITS).join("")}`;
}

function gatesFor(qubitCount: number, map: boolean): Gate[] {
  if (map || qubitCount === 1) return SINGLE_QUBIT;
  if (qubitCount === 0) return [];
  return multiQubit(qubitCount);
}

/**
 * One 8 column grid of square keys, right aligned:
 *   Order screen | Last screen
 *   Q0 … Q7
 *   gate gate gate gate gate gate | INV AC
 *   gate gate gate gate gate gate | MAP DEL
 * Each gate row is right aligned against the controls; empty slots fill
 * the rest.
 * Groups use subgrid, so every key sits on the same grid.
 */
// memo: skips the parent's re-renders while props are unchanged
export const Keyboard = memo(function Keyboard({
  selectedQubits,
  lastInstruction,
  dispatch,
}: KeyboardProps) {
  const [map, setMap] = useState(false);
  const [inverse, setInverse] = useState(false);

  const select = (qubits: number[]) =>
    dispatch({ action: "select-qubits", args: { qubits } });
  const hasQubits = selectedQubits.length > 0;
  const gates = gatesFor(selectedQubits.length, map);
  const slots = Array.from({ length: GATE_ROWS }, (_, r) => {
    const row = gates.slice(r * GATE_COLS, (r + 1) * GATE_COLS);
    return [...Array<undefined>(GATE_COLS - row.length).fill(undefined), ...row];
  }).flat();

  const apply = (gate: Gate) => {
    const args =
      inverse && !gate.selfInverse
        ? { gate: gate.id, inverse: true }
        : { gate: gate.id };
    // Map: Core applies the gate to each selected qubit (all when none)
    dispatch({ action: map ? "map-gate" : "apply-gate", args });
  };

  return (
    <div className="Keyboard" onKeyDown={moveFocus}>
      <Screen
        className="Keyboard-screen"
        label="Order"
        // Single digit qubits, unspaced so all 8 fit
        value={selectedQubits.join("")}
        placeholder="none"
        mono
      />
      <Screen
        className="Keyboard-screen"
        label="Last"
        value={lastInstruction ? describe(lastInstruction) : ""}
        placeholder="none"
      />

      <div className="Keyboard-qubits" role="group" aria-label="Qubits">
        {QUBITS.map((qubit) => {
          const order = selectedQubits.indexOf(qubit);
          return (
            <Key
              key={qubit}
              label={`Qubit ${qubit}`}
              tip={`Qubit ${qubit}${order !== -1 ? `, position ${order + 1}` : ""}`}
              corner={order !== -1 && order + 1}
              isSelected={order !== -1}
              // Core toggles against its own queued selection, so fast clicks
              // don't build on a stale prop. Appends or removes in place.
              onChange={() => dispatch({ action: "toggle-qubit", args: { qubit } })}
            >
              Q<sub>{qubit}</sub>
            </Key>
          );
        })}
      </div>

      <div className="Keyboard-gates" role="group" aria-label="Gates">
        {slots.map((gate, i) => {
          // Empty slots keep the grid shape
          if (!gate) return <div key={`empty-${i}`} className="Keyboard-empty" />;
          const inverted = inverse && !gate.selfInverse;
          const name = inverted ? `Inverse ${gate.name}` : gate.name;
          return (
            <Key
              key={gate.id}
              label={name}
              tip={name}
              corner={inverted && "†"}
              isDisabled={!hasQubits && !map}
              onPress={() => apply(gate)}
            >
              {gate.label}
            </Key>
          );
        })}
      </div>

      <div className="Keyboard-controls" role="group" aria-label="Keypad controls">
        <Key variant="mode" label="Inverse" tip="Inverse"
          isSelected={inverse} onChange={setInverse}>INV</Key>
        <Key variant="clear" label="All clear" tip="All clear"
          onPress={() => dispatch({ action: "reset", args: {} })}>AC</Key>
        <Key variant="mode" label="Map" tip="Map single qubit gate"
          isSelected={map} onChange={setMap}>MAP</Key>
        <Key variant="clear" label="Clear selection" tip="Clear selection"
          onPress={() => select([])}>DEL</Key>
      </div>
    </div>
  );
});

/** Arrow keys move focus between enabled keys by where they sit on screen,
    alongside Tab. Left/Right/Home/End stay in the row; Up/Down go to the
    nearest row with an enabled key, landing on the closest column. No
    wrapping. Screens keep their arrows for the caret. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const from = e.target as HTMLElement;
  if (!from.matches(".Keyboard-key")) return;
  const pos = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { el, x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
  };
  const here = pos(from);
  const keys = [...e.currentTarget.querySelectorAll<HTMLElement>(
    ".Keyboard-key:not([disabled])")].map(pos);
  // Whole rows away, so a row always beats a closer column
  const rows = (p: typeof here) => Math.round((p.y - here.y) / here.h);
  const row = keys.filter((p) => rows(p) === 0).sort((a, b) => a.x - b.x);
  const i = row.findIndex((p) => p.el === from);
  const vertical = (up: boolean) => keys
    .filter((p) => (up ? rows(p) < 0 : rows(p) > 0))
    .sort((a, b) => Math.abs(rows(a)) - Math.abs(rows(b))
      || Math.abs(a.x - here.x) - Math.abs(b.x - here.x))[0];
  const targets: Record<string, () => typeof here | undefined> = {
    ArrowLeft: () => row[i - 1],
    ArrowRight: () => row[i + 1],
    Home: () => row[0],
    End: () => row.at(-1),
    ArrowUp: () => vertical(true),
    ArrowDown: () => vertical(false),
  };
  if (!(e.key in targets)) return;
  // Handled even at an edge, so the page doesn't scroll instead
  e.preventDefault();
  targets[e.key]()?.el.focus();
}

interface KeyProps {
  /** accessible name */
  label: string;
  tip: string;
  /** control key colour: black mode toggle or green clear */
  variant?: "mode" | "clear";
  /** small top right marker, e.g. selection order or inverse dagger */
  corner?: ReactNode;
  /** given → toggle key, otherwise a plain press */
  isSelected?: boolean;
  onChange?: (isSelected: boolean) => void;
  onPress?: () => void;
  isDisabled?: boolean;
  children: ReactNode;
}

/** A square key with a tooltip; a toggle when isSelected is given. */
function Key({
  label,
  tip,
  variant,
  corner,
  isSelected,
  onChange,
  onPress,
  isDisabled,
  children,
}: KeyProps) {
  const className = variant ? `Keyboard-key Keyboard-${variant}` : "Keyboard-key";
  const content = (
    <>
      <span aria-hidden>{children}</span>
      {corner && <span className="Keyboard-corner" aria-hidden>{corner}</span>}
    </>
  );
  return (
    <TooltipTrigger delay={500}>
      {isSelected === undefined ? (
        <Button className={className} aria-label={label}
          isDisabled={isDisabled} onPress={onPress}>
          {content}
        </Button>
      ) : (
        <ToggleButton className={className} aria-label={label}
          isSelected={isSelected} onChange={onChange}>
          {content}
        </ToggleButton>
      )}
      <Tooltip className="Keyboard-tooltip" offset={6}>{tip}</Tooltip>
    </TooltipTrigger>
  );
}
