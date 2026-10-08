package quantumcomputer.port

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
 * Minimal wrapper shaping the project's Command input onto the port
 */
class QSim(n: Int) {
    private val qc = QuantumComputer(n)

    fun apply(command: Command) {
        val gate = when (command.gate) {
            "H" -> Gates.Hadamard
            "T" -> Gates.T
            "CNOT" -> Gates.CNOT
            else -> throw IllegalArgumentException("Unknown gate ${command.gate}")
        }
        qc.applyGate(command.qubits, gate.forward)
    }

    // Fully measure, qubits in ascending order as in the original's tests
    fun measure(): Int = qc.measure((0 until qc.qubits).toList())
}

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
        worlds[0] = Random.nextDouble()
    }

    /**
     * Apply the supplied gate using the specified qubit positions
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
            if (weights[i] == 0.0) continue
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
            require(
                matrix.isNotEmpty() &&
                    matrix.size == matrix[0].size / 2 &&
                    vector.isNotEmpty() &&
                    vector.size / 2 == matrix.size
            ) { "Invalid matrix or vector in applyMatrix" }

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

        fun squaredAmplitude(r: Double, i: Double) = r * r + i * i

        fun partitionWorlds(qubits: List<Int>, totalQubits: Int): Sequence<IntArray> = sequence {
            /**
             * @TODO - Validation
             *  - no duplicates in qubits array
             *  - valid positions in array
             *  - qubits array length < total qubits
             */

            /**
             * Generate an array of bit positions for the free qubits that is the
             * inverse of the input qubit array
             */
            val freeQubits = (0 until totalQubits).filter { it !in qubits }

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
data class Gate(
    val forward: ComplexMatrix,
    val reverse: ComplexMatrix,
)

private val SQRT1_2 = Math.sqrt(0.5)

object Gates {
    val Hadamard = Gate(
        forward = arrayOf(
            doubleArrayOf(SQRT1_2, 0.0, SQRT1_2, 0.0),
            doubleArrayOf(SQRT1_2, 0.0, -SQRT1_2, 0.0),
        ),
        // Hadamard undoes itself. Applying it twice recombines the split worlds.
        reverse = arrayOf(
            doubleArrayOf(SQRT1_2, 0.0, SQRT1_2, 0.0),
            doubleArrayOf(SQRT1_2, 0.0, -SQRT1_2, 0.0),
        ),
    )

    /**
     * Flips the second qubit in the worlds where the first qubit is set, i.e.
     * applyGate([control, target], Gates.CNOT.forward). Its own reverse, since
     * flipping the same worlds twice puts them back.
     */
    val CNOT = Gate(
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
    )

    val T = Gate(
        forward = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, SQRT1_2, SQRT1_2),
        ),
        reverse = arrayOf(
            doubleArrayOf(1.0, 0.0, 0.0, 0.0),
            doubleArrayOf(0.0, 0.0, SQRT1_2, -SQRT1_2),
        ),
    )
}
