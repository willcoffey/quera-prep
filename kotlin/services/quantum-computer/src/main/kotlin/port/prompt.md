```kotlin
import quantumcomputer.port.QuantumSim

val qc = QuantumSim(16) // Init a 16 qubit simulator
for (command in msg.commands)
    qc.apply(bits, gate)

val result = qc.measure(16)
```
