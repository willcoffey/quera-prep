/**
 * @ TODO Contains many hardcodes specific to 8 qubits.
 */
import { Gates, isGate, QuantumComputer } from "../../../quantum-computer/qc";

const GATE_ANIMATION_STEPS = 30;
const GATE_ANIMATION_TIME = 4;
export const SELECT_ANIMATION_TIME = 150;

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
          // Delete any previous results, since the program has
          // changed
          delete this.state.results
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
      case "run-job":
        // Submits the task to the backend with 1000 requested runs
        this.addToChain(() => {
          Core.submitTask(
            this.state.programId,
            this.state.program.slice(),
          ).catch(console.error);
        });
        break;
      case "fetch-results":
        // Read results for the current programId when this event
        // is processed
        this.addToChain(() => {
          return Core.fetchResults(this.state).catch(console.error);
        });
        break;
      case "reset":
        this.eventChain.canceled = true;
        this.state = {
          qc: new QuantumComputer(8),
          programId: "",
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
        return;
        //console.log(event.action, event.args);
    }

    this.onChange();
  }

  /**
   * Basic task submission to backend.
   * No rate limiting, no retry. Simply throws on error.
   */
  static async submitTask(programId: string, program: string[]) {
    if (!program.length) throw new Error("Empty program, not submitting task");
    const idemKey = crypto.getRandomValues(new Uint8Array(32)).toHex();
    const res = await fetch("/tasks/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          idemKey,
          programId,
          commands: program,
          runs: 1000,
        } satisfies CreateTaskBody,
      ),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()).data.taskId as number;
  }

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

  static async fetchResults(state: CoreState) {
    const { programId } = state;
    const res = await fetch(`/tasks/results/${programId}`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const results: number[] = (await res.json()).data.results;
    // Ignore if the program changed while waiting
    if (programId !== state.programId) return;
    state.results = results;
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
  results?: number[];
}

export type CoreEvent =
  | { action: "select-qubits"; args: { qubits: number[] } }
  | { action: "apply-gate"; args: GateInstruction }
  | { action: "reset"; args: {} }
  | { action: "run-job"; args: {} }
  | { action: "fetch-results"; args: {} };

interface GateInstruction {
  gate: string;
  inverse?: boolean;
}

/**
 * Request body for POST /tasks/
 * mirrors CreateTaskBody in TaskManager.kt
 */
interface CreateTaskBody {
  /** /[A-Z0-9]{64}/i */
  idemKey: string;
  /** SHA256 of NSV UTF-8 encoded commands. Hex format */
  programId: string;
  /** A list of command strings, representing gate operations */
  commands: string[];
  /** Positive number of runs */
  runs: number;
}
