
/**
 * Contains real and imaginary parts as interleaved data
 * [real, imaginary, real, imaginary...]
 * therefore array length is twice actual length
 */
type InterleavedComplexVector = number[];
/**
 * It's very important to note that the array contains row vectors, whereas
 * typical math notation uses column vectors.
 */
type ComplexMatrix = InterleavedComplexVector[];

export class QuantumComputer {
  /*
   * array of length 2 * 2 ^ n structured [real, imaginary, real, imaginary...]
   * representing the full state space. complex probability is a real +
   * imaginary
   */
  worlds: Float64Array;
  qubits: number;

  // Initializes state space
  constructor(n: number) {
    this.qubits = n;
    this.worlds = new Float64Array(2 * (2 ** n));

    // All operations are relative, so it doesn't matter what the initial value
    // is
    //this.worlds[0] = Math.random();
    this.worlds[0] = 1;
  }

  /**
   * AI Generated function body - Tested against applyGate
   */
  applyFractionalGate(
    qubits: number[],
    gate: Gate,
    direction: "forward" | "reverse",
    fraction: number,
  ) {
    // Keyed by signed fraction, +f forward and -f reverse
    const key = direction === "forward" ? fraction : -fraction;
    gate.cache ??= new Map();
    let matrix = gate.cache.get(key);

    if (!matrix) {
      // exp(-i·H·t) as a Taylor series, I + A + A²/2! + ..., where A = -i·H·t
      const t = 1 / key;
      const a = gate.generator.map((r) => r.map((_, j) => (j % 2 ? -r[j - 1] : r[j + 1]) * t));
      const aT = a.map((_, i) => a.flatMap((r) => [r[2 * i], r[2 * i + 1]]));
      let term: ComplexMatrix = a.map((r, i) => r.map((_, j) => +(j === 2 * i)));
      matrix = term;
      for (let k = 1; k < 30; k++) {
        term = term.map((r) => QuantumComputer.applyMatrix(aT, r).map((v) => v / k));
        matrix = matrix.map((r, i) => r.map((v, j) => v + term[i][j]));
      }
      gate.cache.set(key, matrix);
    }

    this.applyGate(qubits, matrix);
  }

  /**
   * Apply the supplied gate using the specified qubit positions.
   *
   * qubits is an array of bit positions, with max qubit being <= number of
   * qubits
   */
  applyGate(qubits: number[], gate: ComplexMatrix) {
    /**
     * Each partition is a block of worlds, where the target qubits vary and the
     * free qubits are fixed.
     *
     * for the case of first 3 free, last two are targets. One block would be
     *
     * 11100
     * 11101
     * 11110
     * 11111
     */
    for (const partition of QuantumComputer.partitionWorlds(qubits, this.qubits)) {
      // Get the probability amplitudes for this partition from the state space
      const vector: InterleavedComplexVector = [];
      for (let k = 0; k < partition.length; k++) {
        const world = partition[k];
        vector.push(this.worlds[2 * world], this.worlds[2 * world + 1]);
      }

      // Compute the result of the gate for this partition
      const result = QuantumComputer.applyMatrix(gate, vector);

      // Write the result to the statespace
      for (let k = 0; k < partition.length; k++) {
        const world = partition[k];
        this.worlds[2 * world] = result[2 * k];
        this.worlds[2 * world + 1] = result[2 * k + 1];
      }
    }
  }

  /**
   * Makes a probabilistic measure of the system on the specified qubits
   */
  measure(qubits: number[]): number {
    // The number of possible outcomes, with each number representing a bit config
    const outcomes = 2 ** qubits.length;
    // The squared amplitudes for each outcome
    const weights = new Float64Array(outcomes);
    let sumOfWeights = 0;

    /**
     * Iterate over all partitions of this set of qubits getting probability for
     * each target config and the total weight across all.
     */
    for (const partition of QuantumComputer.partitionWorlds(qubits, this.qubits)) {
      for (let i = 0; i < outcomes; i++) {
        // Pass interleaved complex num to squaring function
        const w = QuantumComputer.squaredAmplitude(
          this.worlds[partition[i] * 2],
          this.worlds[(partition[i] * 2) + 1],
        );
        sumOfWeights += w;
        weights[i] += w;
      }
    }

    /**
     * Pick a random value 0 < r < sumOfWeights and use it to pick a config
     */
    let r = Math.random() * sumOfWeights;
    let outcome = 0;
    for (let i = 0; i < outcomes; i++) {
      if (!weights[i]) continue;
      r -= weights[i];
      outcome = i;
      if (r < 0) break;
    }

    /**
     * Iterate over the qubit partition again, and update the world state to
     * eliminiate the worlds that are against the measurement result.
     */
    for (const partition of QuantumComputer.partitionWorlds(qubits, this.qubits)) {
      for (let i = 0; i < outcomes; i++) {
        if (i === outcome) continue;
        this.worlds[partition[i] * 2] = 0;
        this.worlds[(partition[i] * 2) + 1] = 0;
      }
    }

    return outcome;
  }

  /**
   * Multiples the square matrix representing a quantum gate with the vector
   * of probability amplitudes
   */
  static applyMatrix(
    matrix: ComplexMatrix,
    vector: InterleavedComplexVector,
  ): InterleavedComplexVector {
    /**
     * Ensure that the matrix is square and equal length to the supplied vector
     */
    if (
      !matrix.length ||
      matrix.length != matrix[0].length / 2 ||
      !vector.length ||
      vector.length / 2 != matrix.length
    ) {
      throw "Invalid matrix or vector in applyMatrix";
    }
    const result: InterleavedComplexVector = [];
    for (let i = 0; i < matrix.length; i++) {
      let rSum = 0;
      let iSum = 0;
      for (let j = 0; j < vector.length; j += 2) {
        const [real, imag] = QuantumComputer.complexMultiply(
          matrix[i][j],
          matrix[i][j + 1],
          vector[j],
          vector[j + 1],
        );
        rSum += real;
        iSum += imag;
      }
      result.push(rSum, iSum);
    }
    return result;
  }

  static complexMultiply(r1: number, i1: number, r2: number, i2: number): [number, number] {
    const f = r1 * r2;
    const o = r1 * i2;
    const i = i1 * r2;
    const l = i1 * i2;
    return [f - l, o + i];
  }

  static squaredAmplitude(r: number, i: number) {
    return r * r + i * i;
  }

  /**
   * Logs the config space / worlds as their complex probability amplitude. Not
   * an observation, no collapse
   */
  inspect() {
    for (let i = 0; i < this.worlds.length; i += 2) {
      const real = this.worlds[i];
      const imag = this.worlds[i + 1];
      console.log(`${i / 2} : ${real.toFixed(4)} ${imag.toFixed(4)}`);
    }
  }

  static *partitionWorlds(qubits: number[], totalQubits: number) {
    /**
     * @TODO - Validation
     *  - no duplicates in qubits array
     *  - valid positions in array
     *  - qubits array length < total qubits
     */

    const freeQubits: number[] = [];
    /**
     * Generate an array of bit positions for the free qubits that is the
     * inverse of the input qubit array
     */
    for (let i = 0; i < totalQubits; i++) {
      if (!qubits.includes(i)) freeQubits.push(i);
    }

    /**
     * First, we need to generate all the unique configs that the input qubits
     * can represent. That is, every combination of bit values, at the correct
     * bit positions specified by the input qubits.
     */
    const partialInputConfigs: number[] = [];
    // For every possible number that can be represented by this many bits
    for (let i = 0; i < 2 ** qubits.length; i++) {
      partialInputConfigs.push(QuantumComputer.getPartialConfig(i, qubits));
    }

    /**
     * Next, we do the same for the free qubits, and then for each unique
     * config of free qubits, yield it combined with the partial configs to
     * get a an array of full config space addresses of the same size as
     * partialInputConfigs
     */
    for (let i = 0; i < 2 ** freeQubits.length; i++) {
      const freeConfig = QuantumComputer.getPartialConfig(i, freeQubits);
      yield partialInputConfigs.map((c) => c | freeConfig);
    }
  }

  /**
   * Converts the bit representation for a subset of bits to an expanded
   * representation with 0 for all unspecified bits. I.e.
   *
   * if you had 4 input bits at positions 1,3,5,7 and a config of 11, or
   * 1 0 1 1 in binary then that dense representation would be converted as
   * follows.
   *
   * Note that the bit orider position is reversed from array order in order
   * to maintain convention for respective formats.
   *
   * Input Positions 1 3 5 7
   * Config          1 0 1 1
   *
   * Expanded
   * Bit Position:  7 6 5 4 3 2 1 0
   *                1 0 1 0 0 0 1 0
   *
   * or 162 in decimal
   */
  static getPartialConfig(index: number, positions: number[]): number {
    let config = 0;
    for (let j = 0; j < positions.length; j++) {
      if (index & (2 ** (positions.length - 1 - j))) {
        config += 2 ** positions[j];
      }
    }
    return config;
  }
}

/**
 * A gate paired with the gate that undoes it, so any computation built from
 * these can be run backwards. Many gates are their own reverse.
 */
type Gate = {
  forward: ComplexMatrix;
  reverse: ComplexMatrix;
  /**
   * Paraphrased AI: A hermitian matrix, used to generate forward/reverese as
   * well as allowing ease of fractional application
   */
  generator: ComplexMatrix;
  // Caches generated fractional matricies, for performance when animating.
  cache?: Map<number, ComplexMatrix>;
};

export function isGate(s: string): s is keyof typeof Gates {
  if (Object.hasOwn(Gates, s)) return true;
  return false;
}

/**
 *
 * ==== AI GENERATED CODE BELOW
 *
 */
export const Gates: Record<string, Gate> = {
  Hadamard: {
    forward: [
      [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
      [Math.SQRT1_2, 0, -Math.SQRT1_2, 0],
    ],
    // Hadamard undoes itself. Applying it twice recombines the split worlds.
    reverse: [
      [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
      [Math.SQRT1_2, 0, -Math.SQRT1_2, 0],
    ],
    // (π/2)(I - H), since H is its own reverse
    generator: [
      [Math.PI / 2 * (1 - Math.SQRT1_2), 0, -Math.PI / 2 * Math.SQRT1_2, 0],
      [-Math.PI / 2 * Math.SQRT1_2, 0, Math.PI / 2 * (1 + Math.SQRT1_2), 0],
    ],
  },
  /**
   * Flips the second qubit in the worlds where the first qubit is set, i.e.
   * applyGate([control, target], Gates.CNOT.forward). Its own reverse, since
   * flipping the same worlds twice puts them back.
   */
  CNOT: {
    forward: [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 1, 0, 0, 0],
    ],
    reverse: [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 1, 0, 0, 0],
    ],
    // (π/2)(I - CNOT), since CNOT is its own reverse
    generator: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, Math.PI / 2, 0, -Math.PI / 2, 0],
      [0, 0, 0, 0, -Math.PI / 2, 0, Math.PI / 2, 0],
    ],
  },
  T: {
    forward: [
      [1, 0, 0, 0],
      [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    ],
    reverse: [
      [1, 0, 0, 0],
      [0, 0, Math.SQRT1_2, -Math.SQRT1_2],
    ],
    generator: [
      [0, 0, 0, 0],
      [0, 0, -Math.PI / 4, 0],
    ],
  },
  // Flips the qubit. Its own reverse.
  X: {
    forward: [
      [0, 0, 1, 0],
      [1, 0, 0, 0],
    ],
    reverse: [
      [0, 0, 1, 0],
      [1, 0, 0, 0],
    ],
    // (π/2)(I - X), since X is its own reverse
    generator: [
      [Math.PI / 2, 0, -Math.PI / 2, 0],
      [-Math.PI / 2, 0, Math.PI / 2, 0],
    ],
  },
  // Negates the worlds where the qubit is set. Its own reverse.
  Z: {
    forward: [
      [1, 0, 0, 0],
      [0, 0, -1, 0],
    ],
    reverse: [
      [1, 0, 0, 0],
      [0, 0, -1, 0],
    ],
    generator: [
      [0, 0, 0, 0],
      [0, 0, Math.PI, 0],
    ],
  },
  /**
   * Negate the worlds where every qubit is set, for 4 to 8 qubits. Symmetric
   * like CZ and CCZ, so all qubits act as controls. Each is its own reverse.
   */
  CZ: {
    forward: controlledZ(2),
    reverse: controlledZ(2),
    generator: controlledZGenerator(2),
  },
  CCZ: {
    forward: controlledZ(3),
    reverse: controlledZ(3),
    generator: controlledZGenerator(3),
  },
  CCCZ: {
    forward: controlledZ(4),
    reverse: controlledZ(4),
    generator: controlledZGenerator(4),
  },
  CCCCZ: {
    forward: controlledZ(5),
    reverse: controlledZ(5),
    generator: controlledZGenerator(5),
  },
  CCCCCZ: {
    forward: controlledZ(6),
    reverse: controlledZ(6),
    generator: controlledZGenerator(6),
  },
  CCCCCCZ: {
    forward: controlledZ(7),
    reverse: controlledZ(7),
    generator: controlledZGenerator(7),
  },
  CCCCCCCZ: {
    forward: controlledZ(8),
    reverse: controlledZ(8),
    generator: controlledZGenerator(8),
  },

  /**
   * Exchanges the two qubits. Its own reverse.
   */
  SWAP: {
    forward: [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
    ],
    reverse: [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
    ],
    // (π/2)(I - SWAP), since SWAP is its own reverse
    generator: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, Math.PI / 2, 0, -Math.PI / 2, 0, 0, 0],
      [0, 0, -Math.PI / 2, 0, Math.PI / 2, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  /**
   * Swaps the last two qubits in the worlds where the first is set, i.e.
   * applyGate([control, a, b], Gates.CSWAP.forward). Its own reverse.
   */
  CSWAP: {
    forward: controlledSwap(3),
    reverse: controlledSwap(3),
    generator: controlledSwapGenerator(3),
  },
  /**
   * Flips the last qubit in the worlds where every other qubit is set, for 3
   * to 8 qubits, i.e. CCNOT is Toffoli. Controls first, target last, as CNOT.
   * Each is its own reverse.
   */
  CCNOT: {
    forward: controlledX(3),
    reverse: controlledX(3),
    generator: controlledXGenerator(3),
  },
  CCCNOT: {
    forward: controlledX(4),
    reverse: controlledX(4),
    generator: controlledXGenerator(4),
  },
  CCCCNOT: {
    forward: controlledX(5),
    reverse: controlledX(5),
    generator: controlledXGenerator(5),
  },
  CCCCCNOT: {
    forward: controlledX(6),
    reverse: controlledX(6),
    generator: controlledXGenerator(6),
  },
  CCCCCCNOT: {
    forward: controlledX(7),
    reverse: controlledX(7),
    generator: controlledXGenerator(7),
  },
  CCCCCCCNOT: {
    forward: controlledX(8),
    reverse: controlledX(8),
    generator: controlledXGenerator(8),
  },
  /**
   * T on the worlds where every qubit is set, for 2 to 8 qubits. Symmetric
   * like CZ, so all qubits act as controls.
   */
  CT: {
    forward: controlledT(2, 1),
    reverse: controlledT(2, -1),
    generator: controlledTGenerator(2),
  },
  CCT: {
    forward: controlledT(3, 1),
    reverse: controlledT(3, -1),
    generator: controlledTGenerator(3),
  },
  CCCT: {
    forward: controlledT(4, 1),
    reverse: controlledT(4, -1),
    generator: controlledTGenerator(4),
  },
  CCCCT: {
    forward: controlledT(5, 1),
    reverse: controlledT(5, -1),
    generator: controlledTGenerator(5),
  },
  CCCCCT: {
    forward: controlledT(6, 1),
    reverse: controlledT(6, -1),
    generator: controlledTGenerator(6),
  },
  CCCCCCT: {
    forward: controlledT(7, 1),
    reverse: controlledT(7, -1),
    generator: controlledTGenerator(7),
  },
  CCCCCCCT: {
    forward: controlledT(8, 1),
    reverse: controlledT(8, -1),
    generator: controlledTGenerator(8),
  },
};

/**
 * Identity on n qubits, except the all-ones world is negated. Function
 * declarations are hoisted, so Gates can call this before its definition.
 */
function controlledZ(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    r[2 * row] = row === size - 1 ? -1 : 1;
    return r;
  });
}

/**
 * Zero everywhere except π on the all-ones world, so exp(-i·H) negates that
 * world and leaves the rest alone, matching controlledZ.
 */
function controlledZGenerator(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    if (row === size - 1) r[2 * row] = Math.PI;
    return r;
  });
}

/**
 * Identity on n qubits, except the last two worlds trade amplitudes: the last
 * qubit flips where every other qubit is set.
 */
function controlledX(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    r[2 * (row < size - 2 ? row : row ^ 1)] = 1;
    return r;
  });
}

/**
 * (π/2)(I - X) on the last two worlds and zero elsewhere, as CNOT's, so
 * exp(-i·H) flips the target only where every control is set.
 */
function controlledXGenerator(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    if (row >= size - 2) {
      r[2 * row] = Math.PI / 2;
      r[2 * (row ^ 1)] = -Math.PI / 2;
    }
    return r;
  });
}

/**
 * Identity on n qubits, except worlds ..101 and ..110 trade amplitudes: the
 * last two qubits swap where every other qubit is set.
 */
function controlledSwap(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    const swapped = row === size - 3 || row === size - 2;
    r[2 * (swapped ? row ^ 3 : row)] = 1;
    return r;
  });
}

/** (π/2)(I - SWAP) on worlds ..101 and ..110, zero elsewhere */
function controlledSwapGenerator(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    if (row === size - 3 || row === size - 2) {
      r[2 * row] = Math.PI / 2;
      r[2 * (row ^ 3)] = -Math.PI / 2;
    }
    return r;
  });
}

/**
 * Identity on n qubits, except the all-ones world turns by e^(iπ/4) as T,
 * or back by e^(-iπ/4) with sign -1 for the reverse.
 */
function controlledT(n: number, sign: 1 | -1): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    if (row === size - 1) {
      r[2 * row] = Math.SQRT1_2;
      r[2 * row + 1] = sign * Math.SQRT1_2;
    } else r[2 * row] = 1;
    return r;
  });
}

/** Zero everywhere except -π/4 on the all-ones world, as T's */
function controlledTGenerator(n: number): ComplexMatrix {
  const size = 2 ** n;
  return Array.from({ length: size }, (_, row) => {
    const r: InterleavedComplexVector = new Array(2 * size).fill(0);
    if (row === size - 1) r[2 * row] = -Math.PI / 4;
    return r;
  });
}

