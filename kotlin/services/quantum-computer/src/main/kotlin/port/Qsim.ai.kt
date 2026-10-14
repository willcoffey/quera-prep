package quantumcomputer.port

import kotlin.math.PI
import kotlin.math.sqrt
import kotlin.random.Random
import quantumcomputer.Command

/**
 * Contains real and imaginary parts as interleaved data
 * [real, imaginary, real, imaginary...]
 * therefore array length is twice actual length
 */
typealias InterleavedComplexVector = DoubleArray

/**
 * It's very important to note that the array contains row vectors, whereas
 * typical math notation uses column vectors.
 */
typealias ComplexMatrix = Array<InterleavedComplexVector>

/**
 * Minimal wrapper shaping the project's Command input onto the port.
 */
class QSim(n: Int) {
    private val qc = QuantumComputer(n)

    fun apply(command: Command) {
        // The project names the Hadamard "H", every other name matches Gates
        val name = if (command.gate == "H") "Hadamard" else command.gate
        val gate = Gates[name]
            ?: throw IllegalArgumentException("Unknown gate ${command.gate}")
        qc.applyGate(command.qubits, if (command.reverse) gate.reverse else gate.forward)
    }

    /**
     * Fully measures the system, returning the world index (qubit i = bit i).
     * measure puts qubits[0] in the high bit, so qubits are listed descending.
     */
    fun measure(): Int = qc.measure((qc.qubits - 1 downTo 0).toList())
}

enum class Direction { FORWARD, REVERSE }

class QuantumComputer(n: Int) {
    /*
     * array of length 2 * 2 ^ n structured [real, imaginary, real, imaginary...]
     * representing the full state space. complex probability is a real +
     * imaginary
     */
    val worlds: DoubleArray
    val qubits: Int = n

    // Initializes state space
    init {
        worlds = DoubleArray(2 * (1 shl n))

        // All operations are relative, so it doesn't matter what the initial value
        // is
        //worlds[0] = Random.nextDouble()
        worlds[0] = 1.0
    }

    /**
     * AI Generated function body - Tested against applyGate
     */
    fun applyFractionalGate(
        qubits: List<Int>,
        gate: Gate,
        direction: Direction,
        fraction: Double,
    ) {
        // Keyed by signed fraction, +f forward and -f reverse
        val key = if (direction == Direction.FORWARD) fraction else -fraction
        val cache = gate.cache ?: mutableMapOf<Double, ComplexMatrix>().also { gate.cache = it }
        var matrix = cache[key]

        if (matrix == null) {
            // exp(-i·H·t) as a Taylor series, I + A + A²/2! + ..., where A = -i·H·t
            val t = 1 / key
            val a = Array(gate.generator.size) { i ->
                val r = gate.generator[i]
                DoubleArray(r.size) { j -> (if (j % 2 != 0) -r[j - 1] else r[j + 1]) * t }
            }
            val aT = Array(a.size) { i ->
                DoubleArray(2 * a.size) { k -> a[k / 2][2 * i + k % 2] }
            }
            var term: ComplexMatrix = Array(a.size) { i ->
                DoubleArray(a[i].size) { j -> if (j == 2 * i) 1.0 else 0.0 }
            }
            var sum: ComplexMatrix = term
            for (k in 1 until 30) {
                val prevTerm = term
                term = Array(prevTerm.size) { i ->
                    val v = applyMatrix(aT, prevTerm[i])
                    DoubleArray(v.size) { j -> v[j] / k }
                }
                val prevSum = sum
                val nextTerm = term
                sum = Array(prevSum.size) { i ->
                    DoubleArray(prevSum[i].size) { j -> prevSum[i][j] + nextTerm[i][j] }
                }
            }
            cache[key] = sum
            matrix = sum
        }

        applyGate(qubits, matrix)
    }

    /**
     * Apply the supplied gate using the specified qubit positions.
     *
     * qubits is an array of bit positions, with max qubit being <= number of
     * qubits
     */
    fun applyGate(qubits: List<Int>, gate: ComplexMatrix) {
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
        for (partition in partitionWorlds(qubits, this.qubits)) {
            // Get the probability amplitudes for this partition from the state space
            val vector = InterleavedComplexVector(2 * partition.size)
            for (k in partition.indices) {
                val world = partition[k]
                vector[2 * k] = worlds[2 * world]
                vector[2 * k + 1] = worlds[2 * world + 1]
            }

            // Compute the result of the gate for this partition
            val result = applyMatrix(gate, vector)

            // Write the result to the statespace
            for (k in partition.indices) {
                val world = partition[k]
                worlds[2 * world] = result[2 * k]
                worlds[2 * world + 1] = result[2 * k + 1]
            }
        }
    }

    /**
     * Makes a probabilistic measure of the system on the specified qubits
     */
    fun measure(qubits: List<Int>): Int {
        // The number of possible outcomes, with each number representing a bit config
        val outcomes = 1 shl qubits.size
        // The squared amplitudes for each outcome
        val weights = DoubleArray(outcomes)
        var sumOfWeights = 0.0

        /**
         * Iterate over all partitions of this set of qubits getting probability for
         * each target config and the total weight across all.
         */
        for (partition in partitionWorlds(qubits, this.qubits)) {
            for (i in 0 until outcomes) {
                // Pass interleaved complex num to squaring function
                val w = squaredAmplitude(
                    worlds[partition[i] * 2],
                    worlds[(partition[i] * 2) + 1],
                )
                sumOfWeights += w
                weights[i] += w
            }
        }

        /**
         * Pick a random value 0 < r < sumOfWeights and use it to pick a config
         */
        var r = Random.nextDouble() * sumOfWeights
        var outcome = 0
        for (i in 0 until outcomes) {
            // JS falsy check, 0 or NaN
            if (weights[i] == 0.0 || weights[i].isNaN()) continue
            r -= weights[i]
            outcome = i
            if (r < 0) break
        }

        /**
         * Iterate over the qubit partition again, and update the world state to
         * eliminiate the worlds that are against the measurement result.
         */
        for (partition in partitionWorlds(qubits, this.qubits)) {
            for (i in 0 until outcomes) {
                if (i == outcome) continue
                worlds[partition[i] * 2] = 0.0
                worlds[(partition[i] * 2) + 1] = 0.0
            }
        }

        return outcome
    }

    /**
     * Logs the config space / worlds as their complex probability amplitude. Not
     * an observation, no collapse
     */
    fun inspect() {
        for (i in worlds.indices step 2) {
            val real = worlds[i]
            val imag = worlds[i + 1]
            println("${i / 2} : ${"%.4f".format(real)} ${"%.4f".format(imag)}")
        }
    }

    companion object {
        /**
         * Multiples the square matrix representing a quantum gate with the vector
         * of probability amplitudes
         */
        fun applyMatrix(
            matrix: ComplexMatrix,
            vector: InterleavedComplexVector,
        ): InterleavedComplexVector {
            /**
             * Ensure that the matrix is square and equal length to the supplied vector
             */
            if (
                matrix.isEmpty() ||
                matrix.size != matrix[0].size / 2 ||
                vector.isEmpty() ||
                vector.size / 2 != matrix.size
            ) {
                throw IllegalArgumentException("Invalid matrix or vector in applyMatrix")
            }
            val result = InterleavedComplexVector(2 * matrix.size)
            for (i in matrix.indices) {
                var rSum = 0.0
                var iSum = 0.0
                for (j in vector.indices step 2) {
                    val (real, imag) = complexMultiply(
                        matrix[i][j],
                        matrix[i][j + 1],
                        vector[j],
                        vector[j + 1],
                    )
                    rSum += real
                    iSum += imag
                }
                result[2 * i] = rSum
                result[2 * i + 1] = iSum
            }
            return result
        }

        fun complexMultiply(r1: Double, i1: Double, r2: Double, i2: Double): Pair<Double, Double> {
            val f = r1 * r2
            val o = r1 * i2
            val i = i1 * r2
            val l = i1 * i2
            return Pair(f - l, o + i)
        }

        fun squaredAmplitude(r: Double, i: Double): Double = r * r + i * i

        fun partitionWorlds(qubits: List<Int>, totalQubits: Int): Sequence<IntArray> = sequence {
            /**
             * @TODO - Validation
             *  - no duplicates in qubits array
             *  - valid positions in array
             *  - qubits array length < total qubits
             */

            val freeQubits = mutableListOf<Int>()
            /**
             * Generate an array of bit positions for the free qubits that is the
             * inverse of the input qubit array
             */
            for (i in 0 until totalQubits) {
                if (i !in qubits) freeQubits.add(i)
            }

            /**
             * First, we need to generate all the unique configs that the input qubits
             * can represent. That is, every combination of bit values, at the correct
             * bit positions specified by the input qubits.
             */
            // For every possible number that can be represented by this many bits
            val partialInputConfigs = IntArray(1 shl qubits.size) { getPartialConfig(it, qubits) }

            /**
             * Next, we do the same for the free qubits, and then for each unique
             * config of free qubits, yield it combined with the partial configs to
             * get a an array of full config space addresses of the same size as
             * partialInputConfigs
             */
            for (i in 0 until (1 shl freeQubits.size)) {
                val freeConfig = getPartialConfig(i, freeQubits)
                yield(IntArray(partialInputConfigs.size) { partialInputConfigs[it] or freeConfig })
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
        fun getPartialConfig(index: Int, positions: List<Int>): Int {
            var config = 0
            for (j in positions.indices) {
                if (index and (1 shl (positions.size - 1 - j)) != 0) {
                    config += 1 shl positions[j]
                }
            }
            return config
        }
    }
}

/**
 * A gate paired with the gate that undoes it, so any computation built from
 * these can be run backwards. Many gates are their own reverse.
 */
class Gate(
    val forward: ComplexMatrix,
    val reverse: ComplexMatrix,
    /**
     * Paraphrased AI: A hermitian matrix, used to generate forward/reverese as
     * well as allowing ease of fractional application
     */
    val generator: ComplexMatrix,
    // Caches generated fractional matricies, for performance when animating.
    var cache: MutableMap<Double, ComplexMatrix>? = null,
)

fun isGate(s: String): Boolean = Gates.containsKey(s)

private val SQRT1_2 = sqrt(0.5)

/**
 * Mostly AI Generated Gates
 * Hardcoded gate values have been tested against generator up to the C..CZ
 */
val Gates: Map<String, Gate> = mapOf(
    "Hadamard" to Gate(
        forward = arrayOf(
            doubleArrayOf(SQRT1_2, 0.0, SQRT1_2, 0.0),
            doubleArrayOf(SQRT1_2, 0.0, -SQRT1_2, 0.0),
        ),
        // Hadamard undoes itself. Applying it twice recombines the split worlds.
        reverse = arrayOf(
            doubleArrayOf(SQRT1_2, 0.0, SQRT1_2, 0.0),
            doubleArrayOf(SQRT1_2, 0.0, -SQRT1_2, 0.0),
        ),
        // (π/2)(I - H), since H is its own reverse
        generator = arrayOf(
            doubleArrayOf(PI / 2 * (1 - SQRT1_2), 0.0, -PI / 2 * SQRT1_2, 0.0),
            doubleArrayOf(-PI / 2 * SQRT1_2, 0.0, PI / 2 * (1 + SQRT1_2), 0.0),
        ),
    ),
    /**
     * Flips the second qubit in the worlds where the first qubit is set, i.e.
     * applyGate([control, target], Gates.CNOT.forward). Its own reverse, since
     * flipping the same worlds twice puts them back.
     */
    "CNOT" to Gate(
        forward = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0),
        ),
        reverse = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0),
        ),
        // (π/2)(I - CNOT), since CNOT is its own reverse
        generator = arrayOf(
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, PI / 2, 0.0, -PI / 2, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, -PI / 2, 0.0, PI / 2, 0.0),
        ),
    ),
    "T" to Gate(
        forward = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, SQRT1_2, SQRT1_2),
        ),
        reverse = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, SQRT1_2, -SQRT1_2),
        ),
        generator = arrayOf(
            doubleArrayOf(0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, -PI / 4, 0.0),
        ),
    ),
    // Flips the qubit. Its own reverse.
    "X" to Gate(
        forward = arrayOf(
            doubleArrayOf(0.0, 0.0, 1.0, 0.0),
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
        ),
        reverse = arrayOf(
            doubleArrayOf(0.0, 0.0, 1.0, 0.0),
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
        ),
        // (π/2)(I - X), since X is its own reverse
        generator = arrayOf(
            doubleArrayOf(PI / 2, 0.0, -PI / 2, 0.0),
            doubleArrayOf(-PI / 2, 0.0, PI / 2, 0.0),
        ),
    ),
    // Negates the worlds where the qubit is set. Its own reverse.
    "Z" to Gate(
        forward = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, -1.0, 0.0),
        ),
        reverse = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, -1.0, 0.0),
        ),
        generator = arrayOf(
            doubleArrayOf(0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, PI, 0.0),
        ),
    ),
    /**
     * Negate the worlds where every qubit is set, for 4 to 8 qubits. Symmetric
     * like CZ and CCZ, so all qubits act as controls. Each is its own reverse.
     */
    "CZ" to Gate(
        forward = controlledZ(2),
        reverse = controlledZ(2),
        generator = controlledZGenerator(2),
    ),
    "CCZ" to Gate(
        forward = controlledZ(3),
        reverse = controlledZ(3),
        generator = controlledZGenerator(3),
    ),
    "CCCZ" to Gate(
        forward = controlledZ(4),
        reverse = controlledZ(4),
        generator = controlledZGenerator(4),
    ),
    "CCCCZ" to Gate(
        forward = controlledZ(5),
        reverse = controlledZ(5),
        generator = controlledZGenerator(5),
    ),
    "CCCCCZ" to Gate(
        forward = controlledZ(6),
        reverse = controlledZ(6),
        generator = controlledZGenerator(6),
    ),
    "CCCCCCZ" to Gate(
        forward = controlledZ(7),
        reverse = controlledZ(7),
        generator = controlledZGenerator(7),
    ),
    "CCCCCCCZ" to Gate(
        forward = controlledZ(8),
        reverse = controlledZ(8),
        generator = controlledZGenerator(8),
    ),
    /**
     * Exchanges the two qubits. Its own reverse.
     */
    "SWAP" to Gate(
        forward = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0),
        ),
        reverse = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0),
        ),
        // (π/2)(I - SWAP), since SWAP is its own reverse
        generator = arrayOf(
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, PI / 2, 0.0, -PI / 2, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, -PI / 2, 0.0, PI / 2, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        ),
    ),
    /**
     * Swaps the last two qubits in the worlds where the first is set, i.e.
     * applyGate([control, a, b], Gates.CSWAP.forward). Its own reverse.
     */
    "CSWAP" to Gate(
        forward = controlledSwap(3),
        reverse = controlledSwap(3),
        generator = controlledSwapGenerator(3),
    ),
    /**
     * Flips the last qubit in the worlds where every other qubit is set, for 3
     * to 8 qubits, i.e. CCNOT is Toffoli. Controls first, target last, as CNOT.
     * Each is its own reverse.
     */
    "CCNOT" to Gate(
        forward = controlledX(3),
        reverse = controlledX(3),
        generator = controlledXGenerator(3),
    ),
    "CCCNOT" to Gate(
        forward = controlledX(4),
        reverse = controlledX(4),
        generator = controlledXGenerator(4),
    ),
    "CCCCNOT" to Gate(
        forward = controlledX(5),
        reverse = controlledX(5),
        generator = controlledXGenerator(5),
    ),
    "CCCCCNOT" to Gate(
        forward = controlledX(6),
        reverse = controlledX(6),
        generator = controlledXGenerator(6),
    ),
    "CCCCCCNOT" to Gate(
        forward = controlledX(7),
        reverse = controlledX(7),
        generator = controlledXGenerator(7),
    ),
    "CCCCCCCNOT" to Gate(
        forward = controlledX(8),
        reverse = controlledX(8),
        generator = controlledXGenerator(8),
    ),
    /**
     * T on the worlds where every qubit is set, for 2 to 8 qubits. Symmetric
     * like CZ, so all qubits act as controls.
     */
    "CT" to Gate(
        forward = controlledT(2, 1),
        reverse = controlledT(2, -1),
        generator = controlledTGenerator(2),
    ),
    "CCT" to Gate(
        forward = controlledT(3, 1),
        reverse = controlledT(3, -1),
        generator = controlledTGenerator(3),
    ),
    "CCCT" to Gate(
        forward = controlledT(4, 1),
        reverse = controlledT(4, -1),
        generator = controlledTGenerator(4),
    ),
    "CCCCT" to Gate(
        forward = controlledT(5, 1),
        reverse = controlledT(5, -1),
        generator = controlledTGenerator(5),
    ),
    "CCCCCT" to Gate(
        forward = controlledT(6, 1),
        reverse = controlledT(6, -1),
        generator = controlledTGenerator(6),
    ),
    "CCCCCCT" to Gate(
        forward = controlledT(7, 1),
        reverse = controlledT(7, -1),
        generator = controlledTGenerator(7),
    ),
    "CCCCCCCT" to Gate(
        forward = controlledT(8, 1),
        reverse = controlledT(8, -1),
        generator = controlledTGenerator(8),
    ),
)

/**
 * Identity on n qubits, except the all-ones world is negated.
 */
fun controlledZ(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        r[2 * row] = if (row == size - 1) -1.0 else 1.0
        r
    }
}

/**
 * Zero everywhere except π on the all-ones world, so exp(-i·H) negates that
 * world and leaves the rest alone, matching controlledZ.
 */
fun controlledZGenerator(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        if (row == size - 1) r[2 * row] = PI
        r
    }
}

/**
 * Identity on n qubits, except the last two worlds trade amplitudes: the last
 * qubit flips where every other qubit is set.
 */
fun controlledX(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        r[2 * (if (row < size - 2) row else row xor 1)] = 1.0
        r
    }
}

/**
 * (π/2)(I - X) on the last two worlds and zero elsewhere, as CNOT's, so
 * exp(-i·H) flips the target only where every control is set.
 */
fun controlledXGenerator(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        if (row >= size - 2) {
            r[2 * row] = PI / 2
            r[2 * (row xor 1)] = -PI / 2
        }
        r
    }
}

/**
 * Identity on n qubits, except worlds ..101 and ..110 trade amplitudes: the
 * last two qubits swap where every other qubit is set.
 */
fun controlledSwap(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        val swapped = row == size - 3 || row == size - 2
        r[2 * (if (swapped) row xor 3 else row)] = 1.0
        r
    }
}

/** (π/2)(I - SWAP) on worlds ..101 and ..110, zero elsewhere */
fun controlledSwapGenerator(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        if (row == size - 3 || row == size - 2) {
            r[2 * row] = PI / 2
            r[2 * (row xor 3)] = -PI / 2
        }
        r
    }
}

/**
 * Identity on n qubits, except the all-ones world turns by e^(iπ/4) as T,
 * or back by e^(-iπ/4) with sign -1 for the reverse.
 */
fun controlledT(n: Int, sign: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        if (row == size - 1) {
            r[2 * row] = SQRT1_2
            r[2 * row + 1] = sign * SQRT1_2
        } else {
            r[2 * row] = 1.0
        }
        r
    }
}

/** Zero everywhere except -π/4 on the all-ones world, as T's */
fun controlledTGenerator(n: Int): ComplexMatrix {
    val size = 1 shl n
    return Array(size) { row ->
        val r = InterleavedComplexVector(2 * size)
        if (row == size - 1) r[2 * row] = -PI / 4
        r
    }
}
