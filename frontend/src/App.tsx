// Styling
import "./App.ai.css";
// React
import {useReducer, useState} from "react";

// Minimal state machine
import {Core} from "./Core";

// Component Imports
import {AppBar} from "./components/AppBar/AppBar.ai";
import {StateSpace} from "./components/StateSpace/StateSpace.ai";
import {QubitSelector} from "./components/QubitSelector/QubitSelector.ai";
import {Keypad} from "./components/Keypad/Keypad.ai";

// UI Agnostic state & logic
const core = new Core();
const dispatch = core.dispatch.bind(core);

export function App() {
  /**
   * Setup a piece of state that gets changed whenever core state is
   * changed in order to trigger a re-render. Bit of a hack, not
   * recommened for larger apps.
   */
  const [renderCount, render] = useReducer((n: number) => n + 1, 0);
  core.onChange = render;

  /** Options for config space rendering */
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    gridLines: true,
    showResults: false,
  });

  return (
    <div className="App">
      <AppBar
        programId={core.state.programId}
        dispatch={dispatch}
        displayOptions={displayOptions}
        setDisplayOptions={setDisplayOptions}
      />
      <StateSpace
        displayOptions={displayOptions}
        selectedQubits={core.state.selectedQubits}
        stateVector={core.state.qc.worlds}
        // Since stateVector is always the same float, trigger render
        version={renderCount}
      />
      <QubitSelector
        selectedQubits={core.state.selectedQubits}
        lastInstruction={core.state.lastInstruction}
        dispatch={dispatch}
      />
      <Keypad
        selectedQubits={core.state.selectedQubits}
        dispatch={dispatch}
      />
    </div>
  );
}

export interface DisplayOptions {
  gridLines: boolean;
  showResults: boolean;
}
