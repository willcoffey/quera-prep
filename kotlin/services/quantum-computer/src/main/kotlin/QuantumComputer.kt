package quantumcomputer

import jakarta.validation.Validator
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import java.util.UUID
import org.apache.pulsar.client.api.DeadLetterPolicy
import org.apache.pulsar.client.api.SubscriptionType
import org.apache.pulsar.client.impl.MultiplierRedeliveryBackoff
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.messaging.handler.annotation.Header
import org.springframework.pulsar.annotation.PulsarListener
import org.springframework.pulsar.annotation.PulsarListenerConsumerBuilderCustomizer
import org.springframework.pulsar.core.PulsarTemplate
import org.springframework.pulsar.listener.AckMode
import org.springframework.pulsar.support.PulsarHeaders
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.body
import tools.jackson.core.JacksonException
import tools.jackson.databind.ObjectMapper

/**
 * An AI port of my hand written typescript quantum computer simulator
 */
import quantumcomputer.port.QSim


const val CACHE_PROGRAM_COUNT = 100 // Must be at least 2

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
    "SWAP" to 2,
    "CSWAP" to 3,
    "CCNOT" to 3,
    "CCCNOT" to 4,
    "CCCCNOT" to 5,
    "CCCCCNOT" to 6,
    "CCCCCCNOT" to 7,
    "CCCCCCCNOT" to 8,
    "CT" to 2,
    "CCT" to 3,
    "CCCT" to 4,
    "CCCCT" to 5,
    "CCCCCT" to 6,
    "CCCCCCT" to 7,
    "CCCCCCCT" to 8,

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
    private val programCache = ProgramCache()

    // Create a shared rest client for any task manager requests
    private val taskManagerClient = RestClient.builder()
        .baseUrl("http://task-manager:8080")
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(2000)
                setReadTimeout(5000)
            }
        ).build()

    /**
     * Dead letter q for unhandled errors processing messages that should be
     * retried. i.e. network, qc
     *
     * Like typescript static, a property of the class not an instance of it.
     */
    companion object {
        @Bean
        @JvmStatic
        fun runsDlq() = DeadLetterPolicy.builder().maxRedeliverCount(8).build()

        // Nack backoff 1s, 2s, 4s ... 60s cap, ≈3 min to DLQ
        @Bean
        @JvmStatic
        fun runsBackoff() = PulsarListenerConsumerBuilderCustomizer<ByteArray> {
            it.negativeAckRedeliveryBackoff(MultiplierRedeliveryBackoff.builder().maxDelayMs(60_000).build())
        }
    }


    /**
     * Subscribe to task events
     *
     * @TODO - 2026-10-21
     * Claude: pulsar.send blocks per run; batch listener + sendAsync, then 
     * join and ack/nack per message.
     * Stress test: ~850 runs/s on localhost, but 50ms broker latency drops 
     * it to ~70 runs/s at any gate count.
     *
     */
    @PulsarListener(
        topics = ["runs"],
        subscriptionName = "quantum-computer",
        subscriptionType = [SubscriptionType.Shared],
        ackMode = AckMode.RECORD,
        properties = [
            "receiverQueueSize=50",
            "negativeAckRedeliveryDelayMicros=5000000",
        ],
        deadLetterPolicy = "runsDlq",
    )
    fun run(raw: ByteArray, @Header(PulsarHeaders.REDELIVERY_COUNT) attempt: Int) {
        // Input Validation. Malformed messages will never succeed, ack and drop
        val msg = try {
            parseRun(raw)
        } catch (e: InvalidTaskException) {
            println("Dropping malformed run message: ${e.message}")
            return
        }


        // Create a new QC instance
        try {
            val qc = QSim(QUBITS)

            // Load the program from cache, or fetch it from task-manager
            val commands = loadProgramInstructions(msg.programId)

            // Null commands means an invalid program, but it was still fetched
            if (commands != null) {
                // Execute the program on the sim
                for (command in commands)
                    qc.apply(command)

                // Format the result 
                val result = ResultMsg(msg.programId, msg.taskId, msg.runId, qc.measure())
                pulsar.send("results", json.writeValueAsString(result))
            } else {
                println("Program ${msg.programId} is invalid")
                // Could be more efficient, sends message per run when really a
                // message per task would be sufficient
                val error = ErrorMsg(msg.programId, msg.taskId, msg.runId, "Invalid program")
                pulsar.send("errors", json.writeValueAsString(error))
            }

        } catch (e: Exception) {
            if (attempt < 8) throw e // 8 == maxRedeliverCount, last try before DLQ
            val error = ErrorMsg(msg.programId, msg.taskId, msg.runId, "Run failed: ${e.message}")
            pulsar.send("errors", json.writeValueAsString(error))
        }

    }

    /**
     * Load the program from cache, or fetch it externally into cache
     */
    fun loadProgramInstructions(programId: String): List<Command>? {
        var cache: CacheNode? = null
        /**
         * Lock the thread and lookup the cache value. Updates the linked list
         * so it matches access time
         */
        synchronized(programCache) {
            cache = programCache.cache.get(programId)
            when {
                // Cache miss, do nothing, will be fetched outside lock
                cache == null -> {}
                // Expired cached network error, delete and treat as miss. It
                // gets left in the linked list, but will harmlessly migrate
                // out as more items are added
                cache.expiresAt != null && cache.expiresAt < System.nanoTime() -> {
                    programCache.cache.remove(programId)
                    cache = null
                }
                // Cache is head, do nothing
                cache.next == null -> {}
                // Cache is tail, move to head
                cache.prev == null -> {
                    cache.nextOrFail().prev = null
                    programCache.tail = cache.nextOrFail()
                    cache.next = null
                    cache.prev = programCache.head
                    programCache.head.next = cache
                    programCache.head = cache
                }
                // Cache is somehwere in the middle, update position
                else -> {
                    cache.nextOrFail().prev = cache.prev
                    cache.prevOrFail().next = cache.next
                    cache.next = null
                    cache.prev = programCache.head
                    programCache.head.next = cache
                    programCache.head = cache
                }
            }
            if (cache != null) return cachedCommands(cache)
        }

        // Perform a fetch for the program
        val res = try {
            taskManagerClient.get()
                .uri("/programs/{id}", programId)
                .retrieve()
                .body<APIResponse<Program>>()
        } catch (e: RestClientException) {
            null
        }


        // Parse the commands for validity outside the lock. null == invalid commands.
        val commands = res?.let { runCatching { parseCommands(it.data.commands) }.getOrNull() }


        // Insert the program into cache, and remove any old values
        // Synchronized creates a lock, avoid fetching inside it
        synchronized(programCache) {
            // In case another thread inserted this while we were fetching, if 
            // so, it would have already been added. This access not recored.
            val doubleCheck = programCache.cache.get(programId)
            if (doubleCheck != null) return cachedCommands(doubleCheck)
            if (res == null) {
                // If there was a network error, cache the error with a short TTL
                // so future messages don't spam
                cache = CacheNode(programId, null, System.nanoTime() + 5_000_000_000L)
            } else {
                cache = CacheNode(programId, commands)
            }

            cache.prev = programCache.head
            programCache.head.next = cache
            programCache.head = cache
            programCache.cache.put(programId, cache)
            programCache.size++

            while (programCache.size > CACHE_PROGRAM_COUNT) {
                val tail = programCache.tail
                tail.nextOrFail().prev = null
                programCache.size--

                // The check prevents a network error node that is still in the list from triggering
                // the removal of a fresher fetch
                if (programCache.cache[tail.id] === tail) programCache.cache.remove(tail.id)
                programCache.tail = tail.nextOrFail()
            }

            return cachedCommands(cache)
        }
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

data class ErrorMsg(
    val programId: String,
    val taskId: Long,
    val runId: UUID,
    val message: String,
)


class ProgramCache(
    val cache: HashMap<String, CacheNode> = HashMap(),
    // Size of the linked list, needed because some hash map removals do not
    // remove items from the list, so they build up
    var size: Int = 0,
    var head: CacheNode = CacheNode("head", emptyList()),
    var tail: CacheNode = CacheNode("tail", emptyList()),
) {
    init {
        head.prev = tail
        tail.next = head
    }
}

class CacheNode(
    val id: String,
    val commands: List<Command>? = null,
    // For caching network errors so we don't spam fetches on 404 etc.
    val expiresAt: Long? = null
) {
    var next: CacheNode? = null
    var prev: CacheNode? = null

    // Helper functions to avoid the need for !!
    fun nextOrFail() = next ?: error("Cache list broken: $id has no next")
    fun prevOrFail() = prev ?: error("Cache list broken: $id has no prev")
}

/**
 * Returns a list of valid commands or null if the node has a cached program.
 * If the node represents an error unrelated to commands, such as network, it
 * throws
 */
private fun cachedCommands(node: CacheNode): List<Command>? {
    if (node.expiresAt != null)
        throw IllegalStateException("Cached network error for ${node.id}, try later")
    return node.commands
}



