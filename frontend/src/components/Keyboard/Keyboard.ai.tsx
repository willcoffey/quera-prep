import "./Keyboard.ai.css";
import { memo, useState, type ReactNode } from "react";
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
const GATE_SLOTS = 10;

/** Only the gates the simulator implements; ids are its `Gates` keys.
    H, T and CNOT are a universal set. */
const SINGLE_QUBIT: Gate[] = [
  { id: "Hadamard", label: "H", name: "Hadamard", selfInverse: true },
  { id: "T", label: "T", name: "T" },
  { id: "X", label: "X", name: "Pauli X (NOT)", selfInverse: true },
  { id: "Z", label: "Z", name: "Pauli Z", selfInverse: true },
];

const TWO_QUBIT: Gate[] = [
  { id: "CNOT", label: "•X", name: "Controlled X", selfInverse: true },
  { id: "CZ", label: "•Z", name: "Controlled Z", selfInverse: true },
];

// "‥" is a single character, keeping the label to 2.
const THREE_QUBIT: Gate[] = [
  { id: "CCZ", label: "‥Z", name: "Doubly controlled Z", selfInverse: true },
];

/** n ≥ 4: Z on the all-ones world, n - 1 controls as a superscript count
    ("³Z"). Ids follow the simulator's CCZ, CCCZ, … naming. */
function multiControlledZ(n: number): Gate[] {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const count = String(n - 1).replace(/\d/g, (d) => digits[Number(d)]);
  return [{
    id: `${"C".repeat(n - 1)}Z`,
    label: `${count}Z`,
    name: `${n - 1} controlled Z`,
    selfInverse: true,
  }];
}

/** Short text for the Last screen: key label, † when inverse, then the
    qubits in order (controls first), e.g. "•X 1 0", "T† 3". Worst case
    "⁷Z 0 1 2 3 4 5 6 7" fits half the keyboard on a small phone. */
function describe({ ins, qubits }: NonNullable<KeyboardProps["lastInstruction"]>) {
  const gate = [...SINGLE_QUBIT, ...TWO_QUBIT, ...THREE_QUBIT]
    .find((g) => g.id === ins.gate)
    ?? (/^C+Z$/.test(ins.gate) ? multiControlledZ(ins.gate.length)[0] : undefined);
  const label = (gate?.label ?? ins.gate) + (ins.inverse ? "†" : "");
  // No selection means every qubit, as in Core
  return `${label} ${(qubits.length ? qubits : QUBITS).join(" ")}`;
}

function gatesFor(qubitCount: number, map: boolean): Gate[] {
  if (map) return SINGLE_QUBIT;
  switch (qubitCount) {
    case 0: return [];
    case 1: return SINGLE_QUBIT;
    case 2: return TWO_QUBIT;
    case 3: return THREE_QUBIT;
    default: return multiControlledZ(qubitCount);
  }
}

/**
 * One 8 column grid of square keys, right aligned:
 *   Order screen | Last screen
 *   Q0 … Q7
 *   _ gate gate gate gate gate | INV AC
 *   _ gate gate gate gate gate | MAP DEL
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

  // Selecting appends to the end of the order; deselecting removes in place.
  const toggleQubit = (qubit: number, isSelected: boolean) => {
    const rest = selectedQubits.filter((q) => q !== qubit);
    select(isSelected ? [...rest, qubit] : rest);
  };

  const apply = (gate: Gate) => {
    const args =
      inverse && !gate.selfInverse
        ? { gate: gate.id, inverse: true }
        : { gate: gate.id };
    if (!map) {
      dispatch({ action: "apply-gate", args });
      return;
    }
    // Map is the gate applied to each qubit in turn (selected ones, or all
    // when none are), built from select + apply; then restore the selection.
    for (const q of hasQubits ? selectedQubits : QUBITS) {
      select([q]);
      dispatch({ action: "apply-gate", args });
    }
    select(selectedQubits);
  };

  return (
    <div className="Keyboard">
      <Screen
        className="Keyboard-screen"
        label="Order"
        value={selectedQubits.join(" ")}
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
              onChange={(isSelected) => toggleQubit(qubit, isSelected)}
            >
              Q<sub>{qubit}</sub>
            </Key>
          );
        })}
      </div>

      <div className="Keyboard-gates" role="group" aria-label="Gates">
        {Array.from({ length: GATE_SLOTS }, (_, i) => {
          const gate = gates[i];
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
