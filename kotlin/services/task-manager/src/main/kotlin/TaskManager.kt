package taskmanager
// Universal spring imports
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

// Input validation
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import jakarta.validation.constraints.Max

// Annotations for endpoints
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.PathVariable

//Imports for http and json related processing
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import org.springframework.http.ResponseEntity
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.readValue

// Database related imports
import org.springframework.transaction.annotation.Transactional
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.dao.DataIntegrityViolationException
import kotlin.jvm.optionals.getOrNull
import java.util.UUID

// Pulsar
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.pulsar.annotation.PulsarMessage
import org.springframework.pulsar.core.PulsarTemplate

import org.springframework.pulsar.annotation.PulsarListener
import org.apache.pulsar.common.schema.SchemaType
import org.springframework.stereotype.Component

// JVM entry point
fun main(args: Array<String>) {
    /** Starts all the magical spring auto-config etc */
    runApplication<TaskManager>(*args)
}

@SpringBootApplication
@EnableScheduling
class TaskManager

@RestController
class Endpoints(
    private val db: JdbcClient,
    private val json: ObjectMapper,
    private val pulsar: PulsarTemplate<Any>
) {

    /**
     * Creates a task and queues it for publishing. Idempotent on idemKey.
     *
     * 201 - task created
     * 200 - identical task already exists, returns its id
     * 409 - idemKey already used by a task with a different program
     * 400 - invalid input, or programId is not the SHA256 of commands
     * Returns APIResponse<{
     *  taskId: number;
     * }>
     */
    @PostMapping("/")
    @Transactional
    fun create(@Valid @RequestBody input: CreateTaskBody): ResponseEntity<APIResponse<TaskId>> {
        // Does all the state mutation of inserting the command, sending the messages to trigger
        // runs. Throws when the hash of the commands doesn't match provided id 
        val (taskId, existing) = try {
            insertOrFind(input)
        } catch (e: DataIntegrityViolationException) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "programId does not match commands")
        }

        if (existing == null) {
            return ResponseEntity.status(HttpStatus.CREATED)
                .body(APIResponse("Task accepted", TaskId(taskId)))
        } else if (existing == input.programId) {
            return ResponseEntity.status(HttpStatus.OK)
                .body(APIResponse("Task already exists", TaskId(taskId)))
        } else {
            throw ResponseStatusException(HttpStatus.CONFLICT, "idemKey used by a different task")
        }
    }


    /**
     * Inserts the result of a run into the database, and, if it is the
     * final run for that task, marks the task as complete
     */
    @PulsarListener(topics = ["results"], subscriptionName = "task-manager")
    @Transactional
    fun recordRun(raw: String) {
        // Parse the message, silently swallow malformed message erorrs.
        val msg = runCatching { json.readValue<JobMsg>(raw) }.getOrNull() ?: return

        // Attempt to insert the result into the results database
        val inserted = db.sql(
            """
            INSERT INTO run (run_id, task_id, program_id, result)
            VALUES (:runId, :taskId, :programId, :result)
            ON CONFLICT DO NOTHING
            """
        ).paramSource(msg).update()

        // If the insert didn't run, this is a duplicate. record it.
        if (inserted == 0) {
            db.sql(
                """
                INSERT INTO duplicate_runs (run_id, task_id, program_id, result)
                VALUES (:runId, :taskId, :programId, :result)
                """
            ).paramSource(msg).update()
        }
    }

    /**
     * Records all errors from the topic into the database. Will have an
     * entry for each attempted run even if they are all simply rejected
     * for being invalid and aborting run attempt.
     */
    @PulsarListener(topics = ["errors"], subscriptionName = "task-manager")
    fun recordError(raw: String) {
        // Parse the message, silently swallow malformed message erorrs.
        val msg = runCatching { json.readValue<ErrorMsg>(raw) }.getOrNull() ?: return
        db.sql(
            """
            INSERT INTO errors (run_id, task_id, message)
            VALUES (:runId, :taskId, :message)
            ON CONFLICT DO NOTHING
            """
        ).paramSource(msg).update()
    }


    data class ErrorMsg(
        val programId: String,
        val taskId: Long,
        val runId: UUID,
        val message: String,
    )


    /**
     * Runs every 100ms automatically, reads values from the outbox and sends
     * them to pulsar. removing after pulsar confirms.
     *
     * Drains at rate 10,000 tasks/second
     *
     * Tasks are sent to the "runs" topic
     */
    @Scheduled(fixedDelay = 100)
    @Transactional
    fun drainOutbox() {
        // Load oldest messages in outbox
        val msgs = db.sql(
            """
          SELECT run_id, task_id, program_id
          FROM outbox
          ORDER BY created_at
          LIMIT 1000
          FOR UPDATE SKIP LOCKED
          """
        ).query { rs, _ ->
            TaskMsg(
                rs.getObject("run_id", UUID::class.java),
                rs.getLong("task_id"),
                rs.getString("program_id"),
            )
        }.list()

        if (msgs.isEmpty()) return
        for (msg in msgs) pulsar.sendAsync(msg)
        db.sql("DELETE FROM outbox WHERE run_id IN (:ids)")
            .param("ids", msgs.map { msg -> msg.runId })
            .update()
    }


    /**
     * Inserts task + outbox or finds the existing task
     * Relies on being called from a @Transactional spring function
     */
    private fun insertOrFind(input: CreateTaskBody): InsertResult {
        db.sql(
            """
        INSERT INTO programs (program_id, body)
        VALUES (:program_id, :body)
        ON CONFLICT (program_id) DO NOTHING
        """
        )
            .param("program_id", input.programId)
            .param("body", input.commands.joinToString("\n"))
            .update()

        val id = db
            .sql(
                """
            INSERT INTO task (idem_key, program_id, runs)
            VALUES (:idem_key, :program_id, :runs)
            ON CONFLICT (idem_key) DO NOTHING
            RETURNING task_id
            """
            )
            .param("idem_key", input.idemKey)
            .param("program_id", input.programId)
            .param("runs", input.runs)
            .query(Long::class.java)
            .optional().getOrNull()



        if (id != null) {
            db.sql(
                """
            INSERT INTO outbox (task_id, program_id)
            SELECT :task_id, :program_id FROM generate_series(1, :runs)
            """
            )
                .param("task_id", id)
                .param("program_id", input.programId)
                .param("runs", input.runs)
                .update()
            return InsertResult(id, null)
        } else {
            val (existingId, existingProgramId) = db
                .sql(
                    """
                SELECT task_id, program_id
                FROM task
                WHERE idem_key = :idem_key
                """
                )
                .param("idem_key", input.idemKey)
                .query({ rs, _ -> rs.getLong(1) to rs.getString(2) })
                .single()
            return InsertResult(
                existingId,
                existingProgramId
            )
        }
    }

    private data class InsertResult(val taskId: Long, val existingProgramId: String?)

    /**
     * Inspects the status of a task.
     *
     * 404 - task does not exist
     *
     * Returns APIResponse<{
     *  taskId: number;
     *  complete: boolean;
     * }>
     */
    @GetMapping("/{taskId}/status")
    fun getTaskStatus(@PathVariable @Positive taskId: Long): APIResponse<TaskStatus> {
        val task = db
            .sql(
                """
            SELECT (SELECT count(*) FROM run WHERE run.task_id = task.task_id), task.runs
            FROM task
            WHERE task_id = :taskId
            """
            )
            .param("taskId", taskId)
            .query({ rs, _ -> rs.getInt(1) to rs.getInt(2) })
            .optional()
            .getOrNull()

        if (task == null)
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "Task $taskId not found")

        val (complete, requested) = task
        return APIResponse(
            msg = "$complete of $requested runs complete",
            data = TaskStatus(taskId, complete >= requested)
        )

    }


    /**
     * Loads a program's commands. Programs are immutable (id is the SHA256 of
     * the body) so callers can cache by programId forever.
     *
     * 404 - program does not exist
     * Returns APIResponse<{
     *  programId: string;
     *  commands: string[];
     * }>
     */
    @GetMapping("/programs/{programId}")
    fun getProgram(
        @PathVariable
        @Pattern(regexp = "[0-9a-f]{64}")
        programId: String
    ): APIResponse<Program> {
        val body = db
            .sql("SELECT body FROM programs WHERE program_id = :programId")
            .param("programId", programId)
            .query { rs, _ -> rs.getString(1) }
            .optional()
            .getOrNull()
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Program $programId not found")

        return APIResponse("Retrieved program", Program(programId, body.split("\n")))
    }

    data class Program(val programId: String, val commands: List<String>)


    /**
     * Loads task run results as an array.
     *
     * Returns APIResponse<any[]>
     */
    @GetMapping("/results/{programId}")
    fun results(
        @PathVariable
        @Pattern(regexp = "[0-9a-f]{64}")
        programId: String
    ): APIResponse<RunResults> {
        val results = db
            .sql("SELECT result FROM run WHERE program_id = :programId ORDER BY created_at")
            .param("programId", programId)
            .query { rs, _ -> rs.getInt(1) }
            .list()
        return APIResponse("Retrieved results", RunResults(programId, results.toList()))
    }
}

data class CreateTaskBody(
    @field:Pattern(regexp = "[A-Za-z0-9]{64}", message = "Invalid idemKey submitted")
    val idemKey: String,
    @field:Pattern(regexp = "[0-9a-f]{64}", message = "Invalid programdId submitted")
    val programId: String,
    @field:NotEmpty
    @field:Size(max = 1000)
    val commands: List<@NotBlank @Size(max = 64) String>,
    @field:Positive
    @field:Max(500)
    val runs: Int,
)

data class APIResponse<T>(val msg: String, val data: T)
data class TaskId(val taskId: Long)
data class TaskStatus(val taskId: Long, val complete: Boolean)
data class RunResults(val programId: String, val results: List<Int>)


@PulsarMessage(topic = "runs")
data class TaskMsg(
    val runId: UUID,
    val taskId: Long,
    val programId: String
)

data class JobMsg(
    @field:Positive
    val taskId: Long,
    val programId: String,
    val result: Int,
    val runId: UUID,
)



