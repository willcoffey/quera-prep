/**
 * @ TODO Contains many hardcodes specific to 8 qubits.
 */
//import { Gates, isGate, QuantumComputer } from "../../../quantum-computer/qc";
import { Gates, isGate, QuantumComputer } from "./qc";
import { Client } from "./Client";

const FRAMERATE = 60;
export const ANIMATION_SPEEDS = [1000, 500, 250, 0];

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
      () => {
        this.state.polling = this.client.polling, this.onChange();
      },
    );

    this.state = {
      qc: new QuantumComputer(8),
      programId: "",
      program: [],
      selectedQubits: [],
      status: "COMPLETE",
      animationSpeed: ANIMATION_SPEEDS[1],
      polling: false,
    };
  }

  // Single command bus for processing all external events
  dispatch(event: CoreEvent) {
    switch (event.action) {
      case "select-qubits":
        this.addToChain(() => Core.selectQubits(this.state, event.args.qubits));
        this.addToChain(() =>
          this.state.animationSpeed ? sleep(this.state.animationSpeed) : undefined
        );
        break;
      case "toggle-qubit":
        // Generated: To allow spam clicking selections
        this.addToChain(() => {
          const s = this.state.selectedQubits;
          const q = event.args.qubit;
          Core.selectQubits(
            this.state,
            s.includes(q) ? s.filter((x) => x !== q) : [...s, q],
          );
        });
        this.addToChain(() =>
          this.state.animationSpeed ? sleep(this.state.animationSpeed) : undefined
        );
        break;
      case "map-gate":
        this.addToChain(() => this.mapGate(event.args));
        break;
      case "apply-gate":
        this.addToChain(async () => {
          const state = this.state;
          /** Update the current state to match adding this gate to the program */
          state.status = "PROCESSING";
          state.program.push(
            Core.instructionToCommandString(state.selectedQubits, event.args),
          );
          state.lastInstruction = { ins: event.args, qubits: state.selectedQubits };
          delete state.results;
          await Core.updateProgramId(state);

          /** Apply the gate in steps according to animation settings */
          const steps = Math.ceil((state.animationSpeed * FRAMERATE) / 1000) || 1;
          for (let i = 0; i < steps; i++) {
            Core.applyGateStep(state, event.args, steps);
            this.onChange();
            if (state.animationSpeed) await sleep(state.animationSpeed / steps);
          }
          state.status = "COMPLETE";
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
          animationSpeed: this.state.animationSpeed,
          polling: this.client.polling,
        };
        this.eventChain = {
          canceled: false,
          chain: Promise.resolve(),
        };
        break;
      case "cycle-speed": {
        /**
         * Immediately updates the animation speed to the next entry in the
         * speed array
         */
        const i = ANIMATION_SPEEDS.indexOf(this.state.animationSpeed);
        this.state.animationSpeed = ANIMATION_SPEEDS[(i + 1) % ANIMATION_SPEEDS.length];
        break;
      }
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
   * Apply specifed gate to all selected qubits, default all. single animation
   * AI Generated - Refactor during review
   */
  private async mapGate(ins: GateInstruction) {
    // Captured: after a reset, the rest of this gate lands on the old state
    const state = this.state;

    /** Each selected qubit (all when none) gets its own program line */
    const s = state.selectedQubits;
    const qubits = s.length ? s : [0, 1, 2, 3, 4, 5, 6, 7];
    state.status = "PROCESSING";
    for (const q of qubits) state.program.push(Core.instructionToCommandString([q], ins));
    state.lastInstruction = { ins, qubits };
    delete state.results;
    await Core.updateProgramId(state);

    /** Apply to every qubit each step, so the map animates once */
    if (!isGate(ins.gate)) throw "Invalid Gate";
    const direction = ins.inverse ? "reverse" : "forward";
    const steps = Math.ceil((state.animationSpeed * FRAMERATE) / 1000) || 1;
    for (let i = 0; i < steps; i++) {
      for (const q of qubits) {
        state.qc.applyFractionalGate([q], Gates[ins.gate], direction, steps);
      }
      this.onChange();
      if (state.animationSpeed) await sleep(state.animationSpeed / steps);
    }
    state.status = "COMPLETE";
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
  static applyGateStep(state: CoreState, ins: GateInstruction, steps: number) {
    if (!isGate(ins.gate)) throw "Invalid Gate";
    const gate = Gates[ins.gate];
    const direction = ins.inverse ? "reverse" : "forward";

    // Capture currrent chait and selection since they change while this id waiting
    const qubits = state.selectedQubits;

    state.qc.applyFractionalGate(qubits, gate, direction, steps);
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
  animationSpeed: number;
  lastInstruction?: { ins: GateInstruction; qubits: number[] };
  polling: boolean;
  results?: number[];
}

export type CoreEvent =
  | { action: "select-qubits"; args: { qubits: number[] } }
  | { action: "apply-gate"; args: GateInstruction }
  | { action: "map-gate"; args: GateInstruction }
  | { action: "reset"; args: {} }
  | { action: "run-job"; args: {} }
  | { action: "fetch-results"; args: {} }
  | { action: "toggle-qubit"; args: { qubit: number } }
  | { action: "cycle-speed"; args: {} };

interface GateInstruction {
  gate: string;
  inverse?: boolean;
}
