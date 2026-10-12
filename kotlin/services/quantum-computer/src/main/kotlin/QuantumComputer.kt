package quantumcomputer

// Universal spring imports
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

import java.util.UUID
import tools.jackson.databind.ObjectMapper

// Pulsar
import org.springframework.pulsar.annotation.PulsarListener
import org.springframework.pulsar.core.PulsarTemplate

import tools.jackson.core.JacksonException
import jakarta.validation.Validator
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import jakarta.validation.constraints.Pattern


import org.apache.pulsar.client.api.SubscriptionType
import org.springframework.pulsar.listener.AckMode

/**
 * An AI port of my hand written typescript quantum computer simulator
 */
import quantumcomputer.port.QSim


private const val QUBITS = 8
private val GATE_QUBITS = mapOf(
    "H" to 1,
    "Hadamard" to 1,
    "T" to 1,
    "X" to 1,
    "Z" to 1,
    "CNOT" to 2,
    "CZ" to 2,
    "CCZ" to 3,
    "CCCZ" to 4,
    "CCCCZ" to 5,
    "CCCCCZ" to 6,
    "CCCCCCZ" to 7,
    "CCCCCCCZ" to 8,
)


// JVM entry point
fun main(args: Array<String>) {
    runApplication<QuantumComputer>(*args)
}

@SpringBootApplication
class QuantumComputer(
    private val json: ObjectMapper,
    private val pulsar: PulsarTemplate<Any>,
    private val validator: Validator
) {
    /**
     * Subscribe to task events
     *
     */
    @PulsarListener(
        topics = ["tasks"],
        subscriptionName = "quantum-computer",
        subscriptionType = [SubscriptionType.Shared],
        ackMode = AckMode.RECORD,
        properties = ["receiverQueueSize=1"],
    )
    fun run(raw: ByteArray) {
        // Input Validation
        val msg = try {
            parseTask(raw)
        } catch (e: InvalidTaskException) {
            //@TODO publish error to pulsar
            println(e.message)
            return
        }

        // Run each job
        repeat(msg.runs) { run ->
            val qc = QSim(QUBITS)
            for (command in msg.commands)
                qc.apply(command)

            // redelivery could cause morer runs than requested, but better just to keep all the
            // results if we did the work anyways.
            val runId = UUID.randomUUID()
            val result = ResultMsg(msg.taskId, runId, qc.measure(), run == msg.runs - 1)
            pulsar.send("results", json.writeValueAsString(result))
        }
    }


    fun parseTask(raw: ByteArray): Task {
        val msg: TaskMsg
        try {
            msg = json.readValue(raw, TaskMsg::class.java)
        } catch (e: JacksonException) {
            throw InvalidTaskException("Malformed JSON")
        }

        val violations = validator.validate(msg)
        if (violations.isNotEmpty()) {
            throw InvalidTaskException("Invalid task properties")
        }


        // Parse the command strings into a list of qubit indicies and gate 
        // name

        val commands = mutableListOf<Command>()
        for (c in msg.commands) {
            val parts = c.trim().split(" ")
            if (parts.size < 3)
                throw InvalidTaskException("Invalid command string, must be list of qubit positions followed by gate. i.e. 1 0 CNOT")

            // Parse the gate as the last word in the string
            val (gate, direction) = parts.takeLast(2)


            val qubits = mutableListOf<Int>()
            for (i in parts.dropLast(2)) {
                val q = i.toIntOrNull() ?: throw InvalidTaskException("Invalid qubit value")
                if (q !in 0 until QUBITS) throw InvalidTaskException("Invalid qubit index")
                if (q in qubits) throw InvalidTaskException("Duplicate Qubit")
                qubits.add(q)
            }

            if (GATE_QUBITS[gate] == null)
                throw InvalidTaskException("Invalid gate")
            if (GATE_QUBITS[gate] != qubits.size)
                throw InvalidTaskException("Invalid qubit count for gate")

            commands.add(Command(qubits, gate, direction == "reverse"))
        }

        return Task(msg.taskId, commands, msg.runs)
    }

}

class InvalidTaskException(reason: String) : RuntimeException(reason)
data class TaskMsg(
    @field:Positive
    val taskId: Long,
    @field:NotEmpty @field:Size(max = 1000)
    val commands: List<
            @Pattern(regexp = "\\d+( \\d+)* [A-Za-z]+ (forward|reverse)") String>,
    @field:Positive @field:Max(1000)
    val runs: Int,
)

data class Task(
    val taskId: Long,
    val commands: List<Command>,
    val runs: Int,
)

data class Command(
    val qubits: List<Int>,
    val gate: String,
    val reverse: Boolean
)

data class ResultMsg(
    val taskId: Long,
    val runId: UUID,
    val result: Int,
    val complete: Boolean,
)
