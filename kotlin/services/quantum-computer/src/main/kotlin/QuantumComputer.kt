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

// For REST requests to pull programs from task-manager
import org.springframework.web.client.RestClient
import org.springframework.web.client.body

import org.apache.pulsar.client.api.SubscriptionType
import org.springframework.pulsar.listener.AckMode

/**
 * An AI port of my hand written typescript quantum computer simulator
 */
import quantumcomputer.port.QSim


data class APIResponse<T>(val msg: String, val data: T)
data class Program(val programId: String, val commands: List<String>)

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
    private val validator: Validator,
) {
    /**
     * Cache of recently run programs, avoids excessive task-manager requests
     * eventually could be replaced with local database lookup.
     */
    private val programs = LinkedHashMap<String, List<Command>>()

    /**
     * Subscribe to task events
     *
     */
    @PulsarListener(
        topics = ["runs"],
        subscriptionName = "quantum-computer",
        subscriptionType = [SubscriptionType.Shared],
        ackMode = AckMode.RECORD,
        properties = ["receiverQueueSize=50"],
    )
    fun run(raw: ByteArray) {
        try {
            // Input Validation
            val msg = parseRun(raw)

            // Create a new QC instance
            val qc = QSim(QUBITS)

            // Load the program from cache, or fetch it from task-manager
            val commands = programs.getOrPut(msg.programId) { loadProgramInstructions(msg.programId) }
            if (programs.size > 100) programs.remove(programs.keys.first())

            // Execute the program on the sim
            for (command in commands)
                qc.apply(command)

            // Format the result 
            val result = ResultMsg(msg.programId, msg.taskId, msg.runId, qc.measure())

            pulsar.send("results", json.writeValueAsString(result))
        } catch (e: Exception) {
            println("Run failed ${e.message}")
        }
    }

    fun loadProgramInstructions(programId: String): List<Command> {
        val res = RestClient.create().get()
            .uri("http://task-manager:8080/programs/{id}", programId)
            .retrieve()
            .body<APIResponse<Program>>()
        if (res == null)
            throw IllegalStateException("Empty response for program $programId")
        return parseCommands(res.data.commands)
    }

    /**
     * Parse the command strings into a list of qubit indices, gate name and
     * direction. i.e. "1 0 CNOT forward"
     */
    fun parseCommands(raw: List<String>): List<Command> {
        val commands = mutableListOf<Command>()
        for (c in raw) {
            // Split into a string array of [index, ..., gate, direction], 
            val parts = c.trim().split(" ")
            if (parts.size < 3)
                throw InvalidTaskException("Invalid command string, must be list of qubit positions followed by gate and direction. i.e. 1 0 CNOT forward")

            // Extract gate name and direction
            val (gate, direction) = parts.takeLast(2)
            if (direction != "forward" && direction != "reverse")
                throw InvalidTaskException("Invalid direction")

            // Validate gate name
            if (GATE_QUBITS[gate] == null) throw InvalidTaskException("Invalid gate")

            // Validate qubit indicies
            val qubits = mutableListOf<Int>()
            for (i in parts.dropLast(2)) {
                val q = i.toIntOrNull() ?: throw InvalidTaskException("Invalid qubit value")
                if (q !in 0 until QUBITS) throw InvalidTaskException("Invalid qubit index")
                if (q in qubits) throw InvalidTaskException("Duplicate Qubit")
                qubits.add(q)
            }
            if (GATE_QUBITS[gate] != qubits.size)
                throw InvalidTaskException("Invalid qubit count for gate")

            commands.add(Command(qubits, gate, direction == "reverse"))
        }
        return commands
    }


    /**
     * Parse the raw pulsar message bytes into a TaskMsg
     */
    fun parseRun(raw: ByteArray): TaskMsg {
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
        return msg
    }
}

class InvalidTaskException(reason: String) : RuntimeException(reason)
data class TaskMsg(
    val runId: UUID,
    @field:Positive
    val taskId: Long,
    @field:Pattern(regexp = "[0-9a-f]{64}")
    val programId: String,
)


data class Command(
    val qubits: List<Int>,
    val gate: String,
    val reverse: Boolean
)

data class ResultMsg(
    val programId: String,
    val taskId: Long,
    val runId: UUID,
    val result: Int,
)
