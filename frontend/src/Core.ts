/**
 * @ TODO Contains many hardcodes specific to 8 qubits.
 */
//import { Gates, isGate, QuantumComputer } from "../../../quantum-computer/qc";
import { Gates, isGate, QuantumComputer } from "./qc";
import { Client } from "./Client";

const GATE_ANIMATION_STEPS = 25;
const GATE_ANIMATION_TIME = 10;
export const SELECT_ANIMATION_TIME = 550;

export class Core {
  client: Client;
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
    /** Create a client that is connected to the current state */
    this.client = new Client(
      (data) => {
        if (data.programId == this.state.programId) {
          this.state.results = data.results;
          this.onChange();
        }
      },
      () => this.state.programId,
    );

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
      case "toggle-qubit":
        // Generated: To allow spam clicking selections
        this.addToChain(() => {
          const s = this.state.selectedQubits;
          const q = event.args.qubit;
          Core.selectQubits(this.state, s.includes(q) ? s.filter((x) => x !== q) : [...s, q]);
        });
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
          delete this.state.results;
          this.state.lastInstruction = {
            ins: event.args,
            qubits: this.state.selectedQubits,
          };
          // updateProgramId returns a promise, must be returned
          return Core.updateProgramId(this.state);
        });

        // Add fractional updates to the chain, so that gates appear continous
        for (let i = 0; i < GATE_ANIMATION_STEPS; i++) {
          this.addToChain(async () => {
            Core.applyGateStep(this.state, event.args);
            await sleep(GATE_ANIMATION_TIME);
          });
        }
        this.addToChain(() => {
          this.state.status = "COMPLETE";
        });
        break;
      case "run-job":
        // Submits the task to the backend with 1000 requested runs
        this.addToChain(() => {
          this.client.submitTask(
            this.state.programId,
            this.state.program.slice(),
          ).catch(console.error);
        });
        break;
      case "fetch-results":
        // Immediately starts fetching results for whatever the current
        // programId is. Order not guaranteed.
        this.client.poll();
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

    // Triggers for ANY change, and does not provide source
    this.onChange();
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
  static applyGateStep(state: CoreState, ins: GateInstruction) {
    if (!isGate(ins.gate)) throw "Invalid Gate";
    const gate = Gates[ins.gate];
    const direction = ins.inverse ? "reverse" : "forward";

    // Capture currrent chait and selection since they change while this id waiting
    const qubits = state.selectedQubits;

    state.qc.applyFractionalGate(qubits, gate, direction, GATE_ANIMATION_STEPS);
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
  lastInstruction?: { ins: GateInstruction; qubits: number[] };
  results?: number[];
}

export type CoreEvent =
  | { action: "select-qubits"; args: { qubits: number[] } }
  | { action: "apply-gate"; args: GateInstruction }
  | { action: "reset"; args: {} }
  | { action: "run-job"; args: {} }
  | { action: "fetch-results"; args: {} }
  | { action: "toggle-qubit"; args: { qubit: number } };

interface GateInstruction {
  gate: string;
  inverse?: boolean;
}
