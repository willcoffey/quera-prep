/**
 * @ TODO Contains many hardcodes specific to 8 qubits.
 */
import { Gates, isGate, QuantumComputer } from "../../../quantum-computer/qc";

const GATE_ANIMATION_STEPS = 60;
const GATE_ANIMATION_TIME = 4;
export const SELECT_ANIMATION_TIME = 100;

export class Core {
  state: CoreState;
  // Chain of gate execution that each take some time. for guaranteed gate order
  // on async function.
  eventChain: {
    canceled: boolean;
    chain: Promise<void>;
  } = {
    canceled: false,
    chain: Promise.resolve(),
  };
  constructor() {
    this.state = {
      qc: new QuantumComputer(8),
      programId: "",
      program: [],
      selectedQubits: [],
      status: "COMPLETE",
    };
  }

  // Single command bus for processing all external events
  dispatch(event: CoreEvent) {
    switch (event.action) {
      case "select-qubits":
        this.addToChain(() => Core.selectQubits(this.state, event.args.qubits));
        this.addToChain(() => sleep(SELECT_ANIMATION_TIME));
        break;
      case "apply-gate":
        this.state.status = "PROCESSING";
        // Program update also has to be on the chain since it depends on
        // qubit selection
        this.addToChain(() => {
          this.state.program.push(Core.instructionToCommandString(
            this.state.selectedQubits,
            event.args,
          ));
          return Core.updateProgramId(this.state);
        });

        // Add fractional updates to the chain, so that gates appear continous
        for (let i = 0; i < GATE_ANIMATION_STEPS; i++) {
          this.addToChain(() => Core.applyGateStep(this.state, event.args));
        }
        this.addToChain(() => {
          this.state.status = "COMPLETE";
        });
        break;
      case "reset":
        this.eventChain.canceled = true;
        this.state = {
          qc: new QuantumComputer(8),
          programId: "Lorem",
          program: [],
          selectedQubits: [],
          status: "COMPLETE",
        };
        this.eventChain = {
          canceled: false,
          chain: Promise.resolve(),
        };
        break;

      default:
        console.log(event.action, event.args);
    }

    this.onChange();
  }

  /**
  /**
   * Add a function to the event chain. Useful for running async methods that
   * need to resolve in order. E.g. sleeping between frames
   */
  private addToChain(fn: () => void | Promise<void>) {
    // Capture the current chain
    const chain = this.eventChain;
    chain.chain = chain.chain.then(async () => {
      if (chain.canceled) return;
      await fn();
      this.onChange();
    });
  }

  /**
   * Adds the qubit selection to the event chain, ensures gate and partition
   * animations stay in sync
   */
  static selectQubits(state: CoreState, qubits: number[]) {
    state.selectedQubits = qubits;
  }

  static async updateProgramId(state: CoreState) {
    // Encode nsv command strings
    const bytes = new TextEncoder().encode(state.program.join("\n"));
    // SHA256 of UTF-8 encoded text
    const hash = await crypto.subtle.digest("SHA-256", bytes);

    state.programId = new Uint8Array(hash).toHex();
  }

  /**
   * Records the gate into the program and executes it over `steps` so that it
   * can be smoothly animated
   */
  static async applyGateStep(state: CoreState, ins: GateInstruction) {
    if (!isGate(ins.gate)) throw "Invalid Gate";
    const gate = Gates[ins.gate];
    const direction = ins.inverse ? "reverse" : "forward";

    // Capture currrent chait and selection since they change while this id waiting
    const qubits = state.selectedQubits;

    state.lastInstruction = ins.gate;
    state.qc.applyFractionalGate(qubits, gate, direction, GATE_ANIMATION_STEPS);
    await sleep(GATE_ANIMATION_TIME);
  }

  /**
   * Converts JSON object from UI event to command string for backend
   *  1 0 CNOT forward
   *  3 T reverse
   *  0 1 2 3 4 5 6 7 CCCCCCCZ forward
   */
  static instructionToCommandString(qubits: number[], ins: GateInstruction): string {
    if (!qubits.length) qubits = [0, 1, 2, 3, 4, 5, 6, 7];
    return `${qubits.join(" ")} ${ins.gate} ${ins.inverse ? "reverse" : "forward"}`;
  }

  onChange: () => void = () => {};
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

interface CoreState {
  qc: QuantumComputer;
  program: string[];
  programId: string;
  selectedQubits: number[];
  status: "PROCESSING" | "COMPLETE";
  lastInstruction?: string;
}

export type CoreEvent =
  | { action: "select-qubits"; args: { qubits: number[] } }
  | { action: "apply-gate"; args: GateInstruction }
  | { action: "reset"; args: {} }
  | { action: "run-job"; args: {} };

interface GateInstruction {
  gate: string;
  inverse?: boolean;
}
