import "./QubitSelector.ai.css";
import {
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import type { CoreEvent } from "../../Core";
import { Screen } from "../Utility/Screen.ai";

interface QubitSelectorProps {
  selectedQubits: number[];
  /** command string of the most recent gate, e.g. "1 0 CNOT forward" */
  lastInstruction?: string;
  dispatch: (event: CoreEvent) => void;
}

const QUBITS = [0, 1, 2, 3, 4, 5, 6, 7];

export function QubitSelector({
  selectedQubits,
  lastInstruction = "",
  dispatch,
}: QubitSelectorProps) {
  // Selecting appends to the end of the order; deselecting removes in place.
  const toggle = (qubit: number, isSelected: boolean) => {
    const next = isSelected
      ? [...selectedQubits.filter((q) => q !== qubit), qubit]
      : selectedQubits.filter((q) => q !== qubit);
    dispatch({ action: "select-qubits", args: { qubits: next } });
  };

  // A row split between order and last instruction, then a row of 8 buttons.
  return (
    <div className="QubitSelector">
      <div className="QubitSelector-info">
        <Screen
          label="Order"
          value={selectedQubits.join(" ")}
          placeholder="none"
          mono
        />
        <Screen label="Last" value={lastInstruction} placeholder="none" />
      </div>
      <div className="QubitSelector-buttons" role="group" aria-label="Qubits">
        {QUBITS.map((qubit) => {
          const order = selectedQubits.indexOf(qubit);
          return (
            <TooltipTrigger key={qubit} delay={500}>
              <ToggleButton
                className="QubitSelector-button"
                aria-label={`Qubit ${qubit}`}
                isSelected={order !== -1}
                onChange={(isSelected) => toggle(qubit, isSelected)}
              >
                <span aria-hidden>
                  Q<sub>{qubit}</sub>
                </span>
                {order !== -1 && (
                  <span className="QubitSelector-order" aria-hidden>
                    {order + 1}
                  </span>
                )}
              </ToggleButton>
              <Tooltip className="QubitSelector-tooltip" offset={6}>
                Qubit {qubit}
                {order !== -1 && `, position ${order + 1}`}
              </Tooltip>
            </TooltipTrigger>
          );
        })}
      </div>
    </div>
  );
}
