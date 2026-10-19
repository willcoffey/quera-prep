export interface Program {
  name: string;
  commands: string[];
}

/**
 * Hand made programs where every gate changes the measured distribution.
 * Command strings are "<qubits> <gate> <direction>", targets last.
 * Keyed by name so duplicate names are a compile error.
 */
const DEFINITIONS: Record<string, string[]> = {
  /**
   * Permutations only, so a single outcome: q1, q2, q5, q6, q7 set. Any wrong
   * qubit, target or bit order lands somewhere else.
   */
  permutations: [
    "0 X forward",
    "3 X forward",
    "0 5 SWAP forward", // q3, q5
    "5 1 CNOT forward", // q1, q3, q5
    "1 3 6 CSWAP forward", // q1, q5, q6
    "5 6 7 CCNOT forward", // q1, q5, q6, q7
    "1 5 6 2 CCCNOT forward", // q1, q2, q5, q6, q7
  ],

  /**
   * Phases only show through interference, so each is wrapped in H.
   * q0: H T H, ~85/15. q1: H T T' H, always 0. q2: H Z H, always 1
   */
  phases: [
    "0 Hadamard forward",
    "0 T forward",
    "0 Hadamard forward",
    "1 Hadamard forward",
    "1 T forward",
    "1 T reverse",
    "1 Hadamard forward",
    "2 Hadamard forward",
    "2 Z forward",
    "2 Hadamard forward",
  ],

  /**
   * Controlled Z kicks back as a NOT on the H wrapped qubit.
   * q0, q1: 50/50 on 00 and 11. q4: always 1, since q2 and q3 are set
   */
  controlledZ: [
    "0 Hadamard forward",
    "1 Hadamard forward",
    "0 1 CZ forward",
    "1 Hadamard forward",
    "2 X forward",
    "3 X forward",
    "4 Hadamard forward",
    "2 3 4 CCZ forward",
    "4 Hadamard forward",
  ],

  /**
   * Controlled T on an H wrapped qubit. q1: CT once, ~85/15.
   * q4: CCT twice is S, 50/50. Neither turns if a control is unset
   */
  controlledT: [
    "0 X forward",
    "1 Hadamard forward",
    "0 1 CT forward",
    "1 Hadamard forward",
    "2 X forward",
    "3 X forward",
    "4 Hadamard forward",
    "2 3 4 CCT forward",
    "2 3 4 CCT forward",
    "4 Hadamard forward",
  ],

  /**
   * Entanglement. GHZ on q0-q3, then q5 flips only where q0-q4 are all set.
   * 25% each: 0, q0-q3, q4, q0-q5
   */
  entanglement: [
    "0 Hadamard forward",
    "0 1 CNOT forward",
    "1 2 CNOT forward",
    "0 2 3 CCNOT forward",
    "4 Hadamard forward",
    "0 1 2 3 4 5 CCCCCNOT forward",
  ],
};

export const PROGRAMS: Program[] = Object.entries(DEFINITIONS).map(
  ([name, commands]) => ({ name, commands })
);
