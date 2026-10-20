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
import org.springframework.web.bind.annotation.RequestParam

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


// We use scheduling for draining the outbox
@SpringBootApplication
class TaskManager


// JVM entry point
fun main(args: Array<String>) {
    /** Starts all the magical spring auto-config etc */
    runApplication<TaskManager>(*args)
}


@RestController
class Endpoints(
    private val db: JdbcClient,
    private val json: ObjectMapper,
    private val pulsar: PulsarTemplate<Any>,
    private val taskService: TaskService
) {
    /**
     * POST /tasks
     *
     * Saves the submitted task to the database and publishes job messages to
     * Pulsar. One for each run, immediately queued for processing.
     *
     * 201 - task created
     * 200 - identical task already exists, returns its id
     * 409 - idemKey already used by a task with a different program
     * 400 - invalid input, or programId is not the SHA256 of commands
     *
     * Returns APIResponse<{ taskId: number }>
     */
    @PostMapping("/")
    fun create(@Valid @RequestBody input: CreateTaskBody): ResponseEntity<APIResponse<TaskId>> {
        val result = taskService.insertOrFind(input)
        return when {
            // Body hash mismatch program Id
            result == null ->
                throw ResponseStatusException(HttpStatus.BAD_REQUEST, "programId does not match commands")
            // New task created
            result.existingProgramId == null -> ResponseEntity.status(HttpStatus.CREATED)
                .body(APIResponse("Task accepted", TaskId(result.taskId)))
            // Existing task, but it matches
            result.existingProgramId == input.programId -> ResponseEntity.status(HttpStatus.OK)
                .body(APIResponse("Task already exists", TaskId(result.taskId)))
            // Exsiting task, but it's a mismatch
            else ->
                throw ResponseStatusException(HttpStatus.CONFLICT, "idemKey used by a different task")
        }
    }


    /**
     * GET /tasks/{taskId}/status
     *
     * Counts the number of successful runs and error runs for the speified
     * task. Returns those counts the the client, which decides for itself if
     * the task is complete or not.
     *
     * @TODO - Two queries to count each time is excessive. A future schema
     * refactor for simply storing status would be better. Same refactor as
     * results to create a ResultsTransformer
     *
     * 404 - task does not exist
     *
     * Returns APIResponse<{
     *  taskId: number;
     *  requested: number;
     *  complete: number;
     *  failed: number;
     * }>
     */
    @GetMapping("/{taskId}/status")
    fun getTaskStatus(@PathVariable @Positive taskId: Long): APIResponse<TaskStatus> {
        // Query the database to get run and error counts associated with the
        // task as well as the number of runs on the task.
        val task = db
            .sql(
                """
            SELECT
              (SELECT count(*) FROM run WHERE run.task_id = task.task_id),
              (SELECT count(*) FROM errors WHERE errors.task_id = task.task_id),
              task.runs
            FROM task
            WHERE task_id = :taskId
            """
            )
            .param("taskId", taskId)
            .query({ rs, _ -> Triple(rs.getInt(1), rs.getInt(2), rs.getInt(3)) })
            .optional()
            .getOrNull()
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Task $taskId not found")
        val (complete, failed, requested) = task
        return APIResponse(
            msg = "$complete of $requested runs complete, $failed failed",
            data = TaskStatus(taskId, requested, complete, failed)
        )
    }


    /**
     * GET /tasks/{programId}
     *
     * Loads the instruction list for a program. The programId is a SHA256 of
     * the commands, so consumers can cache the program forever without risk
     * of it getting out of sync.
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


    /**
     * GET /tasks/results/{programId}[?taskId={taskId}]
     *
     * Loads all run results for the specified program id. Results are simply
     * a list of integers that represent the measurement made for a single shot.
     *
     * Optionally, a taskId can be submitted which limits runs to only those run
     * under that taskId.
     *
     * @TODO A ResultsTransformer service should be added to combine results
     * into a simpler data structure. A list of the 256 possible outcomes and
     * their counts. This also can simplify status querying.
     *
     * @TODO There is no pagination or cursor, results is simply limited to a
     * max response of 500,000 results. This represents about 1.8 mb and a
     * compute time of ~8 min for a 10 gate program. for a 100 gate program it
     * would be ~26 min. (Based on dev log # Sat Oct 17 03:59:16 PM EDT 2026)

     * Returns APIResponse<any[]>
     */
    @GetMapping("/results/{programId}")
    fun results(
        @PathVariable
        @Pattern(regexp = "[0-9a-f]{64}")
        programId: String,
        @RequestParam(required = false)
        @Positive
        taskId: Long?
    ): APIResponse<RunResults> {
        val results = db
            .sql(
                """
            SELECT result FROM run
            WHERE program_id = :programId
            AND (CAST(:taskId AS BIGINT) IS NULL OR task_id = :taskId)
            ORDER BY created_at DESC
            LIMIT 500000
            """
            )
            .param("programId", programId)
            .param("taskId", taskId)
            .query { rs, _ -> rs.getInt(1) }
            .list()
        return APIResponse("Retrieved results", RunResults(programId, results.toList()))
    }
}


/**
 * Component for managing Pulsar interactions. Contains all Pulsar
 * Listeners, handles the dead letter queue, and schedules function
 * executions to drain the outbox.
 */
@Component
@EnableScheduling
class PulsarHandler(
    private val tasks: TaskService,
    private val json: ObjectMapper,
    private val pulsar: PulsarTemplate<Any>,
    private val db: JdbcClient,
) {
    /**
     * Processes job results messages produced by a worker replica. Inserts the
     * run into the results database, and records any duplicate runs in a second
     * catchall table. Runs are considered expensive, so we record the rare
     * instance where pulsar double sends a job so it can be inspected later.
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

    /**
     * Consumes the dead letter queue and records any messages that end up there
     * into the database. This shouldn't really run, as workers already send an
     * error when they see that a message is the last attempt.
     *
     * Need to handle conflicts since the worker could throw and send an error
     * message on the last retry, leading to the dlq getting a message for the
     * same run. This only occurs when the worker throws in a new way that
     * causes it to send an error message, but also not ack the message.
     */
    @PulsarListener(
        topics = ["persistent://public/default/runs-quantum-computer-DLQ"],
        subscriptionName = "dlq"
    )
    fun drainDead(raw: ByteArray) {
        val m = runCatching { json.readValue(raw, TaskMsg::class.java) }.getOrNull() ?: return
        // On conflict prevents case where DLQ times out an a qc error for a non-dlq error
        db.sql(
            """
            INSERT INTO errors (run_id, task_id, message)
            VALUES (:runId, :taskId, 'Unknown run failure')
            ON CONFLICT DO NOTHING
            """
        ).paramSource(m).update()
    }

    /**
     * Runs on a schedule to drain the outbox table. This is required to tie
     * message sending to an atomic operation so there is no risk of recording
     * a request to the database without also sending to on a topic.
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
        /**
         * Using plain send() works but is slow, as it waits for ack before
         * next message. sendAsync isn't safe without ensuring everything
         * completes. A failed send throws and it just tries again on the
         * schedule
         */
        val pending = msgs.map { msg -> pulsar.sendAsync(msg) }
        pending.forEach { send -> send.join() }

        db.sql("DELETE FROM outbox WHERE run_id IN (:ids)")
            .param("ids", msgs.map { msg -> msg.runId })
            .update()
    }
}


/** Data classes only below */

data class CreateTaskBody(
    @field:Pattern(regexp = "[A-Za-z0-9]{64}", message = "Invalid idemKey submitted")
    val idemKey: String,
    @field:Pattern(regexp = "[0-9a-f]{64}", message = "Invalid programdId submitted")
    val programId: String,
    @field:NotEmpty
    @field:Size(max = 1000)
    val commands: List<@NotBlank @Size(max = 64) String>,
    @field:Positive
    @field:Max(3000)
    val runs: Int,
)

data class APIResponse<T>(val msg: String, val data: T)
data class TaskId(val taskId: Long)
data class TaskStatus(
    val taskId: Long,
    val requested: Int,
    val complete: Int,
    val failed: Int,
)

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

data class ErrorMsg(
    val programId: String,
    val taskId: Long,
    val runId: UUID,
    val message: String,
)

data class Program(val programId: String, val commands: List<String>)
