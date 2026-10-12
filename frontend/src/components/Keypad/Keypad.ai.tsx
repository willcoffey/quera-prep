import "./Keypad.ai.css";
import { useState, type ReactNode } from "react";
import {
  Button,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import type { CoreEvent } from "../../Core";

interface KeypadProps {
  selectedQubits: number[];
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

const GATE_SLOTS = 10;
/** Map with nothing selected applies to every qubit. Matches Core. */
const ALL_QUBITS = [0, 1, 2, 3, 4, 5, 6, 7];

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

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={500}>
      {children}
      <Tooltip className="Keypad-tooltip" offset={6}>
        {text}
      </Tooltip>
    </TooltipTrigger>
  );
}

export function Keypad({ selectedQubits, dispatch }: KeypadProps) {
  const [map, setMap] = useState(false);
  const [inverse, setInverse] = useState(false);

  const gates = gatesFor(selectedQubits.length, map);
  const slots = Array.from({ length: GATE_SLOTS }, (_, i) => gates[i]);
  const hasQubits = selectedQubits.length > 0;

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
    for (const q of hasQubits ? selectedQubits : ALL_QUBITS) {
      dispatch({ action: "select-qubits", args: { qubits: [q] } });
      dispatch({ action: "apply-gate", args });
    }
    dispatch({ action: "select-qubits", args: { qubits: selectedQubits } });
  };

  // 5 gate columns, then 2 control columns; empty slots keep the grid shape.
  return (
    <div className="Keypad">
      <div className="Keypad-gates" role="group" aria-label="Gates">
        {slots.map((gate, i) => {
          if (!gate) {
            return <div key={`empty-${i}`} className="Keypad-empty" aria-hidden />;
          }
          const inverted = inverse && !gate.selfInverse;
          const name = inverted ? `Inverse ${gate.name}` : gate.name;
          return (
            <Tip key={gate.id} text={name}>
              <Button
                className="Keypad-button Keypad-gate"
                aria-label={name}
                isDisabled={!hasQubits && !map}
                onPress={() => apply(gate)}
              >
                <span aria-hidden>{gate.label}</span>
                {inverted && (
                  <span className="Keypad-dagger" aria-hidden>†</span>
                )}
              </Button>
            </Tip>
          );
        })}
      </div>
      <div className="Keypad-controls" role="group" aria-label="Keypad controls">
        <Tip text="Inverse">
          <ToggleButton
            className="Keypad-button Keypad-control"
            aria-label="Inverse"
            isSelected={inverse}
            onChange={setInverse}
          >
            <span aria-hidden>†</span>
          </ToggleButton>
        </Tip>
        <Tip text="All clear">
          <Button
            className="Keypad-button Keypad-control"
            aria-label="All clear"
            onPress={() => dispatch({ action: "reset", args: {} })}
          >
            AC
          </Button>
        </Tip>
        <Tip text="Map single qubit gate">
          <ToggleButton
            className="Keypad-button Keypad-control"
            aria-label="Map"
            isSelected={map}
            onChange={setMap}
          >
            <span aria-hidden>↦</span>
          </ToggleButton>
        </Tip>
        <Tip text="Clear selection">
          <Button
            className="Keypad-button Keypad-control"
            aria-label="Clear selection"
            onPress={() => dispatch({ action: "select-qubits", args: { qubits: [] } })}
          >
            CE
          </Button>
        </Tip>
      </div>
    </div>
  );
}
