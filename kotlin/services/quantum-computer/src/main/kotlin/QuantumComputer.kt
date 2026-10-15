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
import org.springframework.web.client.RestClientException

import org.apache.pulsar.client.api.SubscriptionType
import org.springframework.pulsar.listener.AckMode

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
        // Input Validation
        val msg = parseRun(raw)

        // Create a new QC instance
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
            // @TODO - Send an error message or something
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
            RestClient.create().get()
                .uri("http://task-manager:8080/programs/{id}", programId)
                .retrieve()
                .body<APIResponse<Program>>()
        } catch (e: RestClientException) {
            null
        }
        // Parse the commands for validity outside the lock. null == invalid commands.
        val commands = res?.let { runCatching { parseCommands(it.data.commands) }.getOrNull() }


        // Insert the program into cache, and remove any old values
        synchronized(programCache) {
            // In case another thread inserted this while we were fetching, if 
            // so, it would have already been added. This access not recored.
            val doubleCheck = programCache.cache.get(programId)
            if (doubleCheck != null) return cachedCommands(doubleCheck)
            if (res == null) {
                // If there was a network error, cache the error with a short TTL
                // so future messages don't spam
                cache = CacheNode(programId, null, System.nanoTime() + 60_000_000_000L)
            } else {
                cache = CacheNode(programId, commands)
            }

            cache.prev = programCache.head
            programCache.head.next = cache
            programCache.head = cache
            programCache.cache.put(programId, cache)

            while (programCache.cache.size > CACHE_PROGRAM_COUNT) {
                val tail = programCache.tail
                tail.nextOrFail().prev = null

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


class ProgramCache(
    val cache: HashMap<String, CacheNode> = HashMap(),
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

