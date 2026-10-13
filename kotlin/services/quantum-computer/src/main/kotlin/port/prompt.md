
Your task is to faithfully port a TypeScript quantum simulator to Kotlin
for use in this project. The target file is `./Qsim.ai.kt`

The TypeScript project is located at
`~/repos/quantum-computer/`

The only parts that need to be available are:
```kotlin
import quantumcomputer.port.QSim

data class Command(
    // A list of qubit positions, i.e. index in a bitstring
    val qubits: List<Int>,
    // The name of a gate. Any gate in the TypeScript `Gates`, plus H as an
    // alias for Hadamard
    val gate: String,
    // Apply the gate's reverse instead of forward
    val reverse: Boolean
)
val qc = QSim(QUBITS)
qc.apply(command : Command)
val result : Int = qc.measure()
```

For how it is used see `../QuantumComputer.kt`

You are only allowed to modify `Qsim.ai.kt`

---
QA:

Follow the shape of the original, but use the primitives that make sense in
Kotlin. Don't add new optimizations.

`measure()` should simply fully measure. Make a minimal class that exports
these methods, wrapping the port to shape the input.

`measure()` returns the world index (qubit i = bit i).

