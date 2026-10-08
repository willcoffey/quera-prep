package quantumcomputer
// Universal spring imports
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

import tools.jackson.databind.ObjectMapper
import java.util.UUID

// Pulsar
import org.springframework.pulsar.annotation.PulsarListener
import org.springframework.pulsar.core.PulsarTemplate

// JVM entry point
fun main(args: Array<String>) {
    runApplication<QuantumComputer>(*args)
}

@SpringBootApplication
class QuantumComputer(
    private val json: ObjectMapper,
    private val pulsar: PulsarTemplate<Any>
) {
    /**
     * Receives tasks from task-manager, answers every one with 4.
     * ByteArray since "tasks" carries task-manager's JSON schema
     */
    @PulsarListener(topics = ["tasks"], subscriptionName = "quantum-computer")
    fun run(raw: ByteArray) {
        val taskId = json.readTree(raw).get("taskId").asLong()
        val msg = mapOf(
            "taskId" to taskId,
            "runId" to UUID.randomUUID(),
            "result" to 4,
            "complete" to true,
        )
        pulsar.send("results", json.writeValueAsString(msg))
    }
}

