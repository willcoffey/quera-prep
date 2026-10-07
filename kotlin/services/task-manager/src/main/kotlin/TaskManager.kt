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
     * 409 - idemKey already used by a task with different commands
     * 400 - invalid input
     * Returns APIResponse<{
     *  taskId: number;
     * }>
     */
    @PostMapping("/create")
    @Transactional
    fun create(@Valid @RequestBody input: CreateTaskBody): ResponseEntity<APIResponse<TaskId>> {
        val (taskId, existing) = insertOrFind(input)
        if (existing == null) {
            return ResponseEntity.status(HttpStatus.CREATED)
                .body(APIResponse("Task accepted", TaskId(taskId)))
        } else if (existing == input.commands) {
            return ResponseEntity.status(HttpStatus.OK)
                .body(APIResponse("Task already exists", TaskId(taskId)))
        } else {
            throw ResponseStatusException(HttpStatus.CONFLICT, "idemKey used by a different task")
        }
    }


    @PulsarListener(topics = ["results"], subscriptionName = "task-manager")
    @Transactional
    fun complete(raw: String) {
        val msg = json.readValue<JobMsg>(raw)

        // Duplicate sends conflict on run_id and are dropped
        db
            .sql(
                """
            INSERT INTO run (run_id, task_id, result)
            VALUES (:run_id, :task_id, :result::jsonb)
            ON CONFLICT (run_id) DO NOTHING
            """
            )
            .param("run_id", msg.runId)
            .param("task_id", msg.taskId)
            .param("result", json.writeValueAsString(msg.result))
            .update()


            // Hack until I decide how runs are going to be managed
        if (msg.complete) {
            db
                .sql(
                    """
                UPDATE task
                SET complete_runs = requested_runs
                WHERE task_id = :id
                """
                )
                .param("id", msg.taskId).update()
        }
    }

    /**
     * Runs every 500ms automatically, reads values from the outbox and sends
     * them to pulsar. removing after pulsar confirms.
     *
     * Drains at rate 200 tasks/second, job estimates at minutes per task
     *
     * Tasks are sent to the "tasks" topic
     */
    @Scheduled(fixedDelay = 500)
    @Transactional
    fun drainOutbox() {
        // Load oldest messages in outbox
        val msgs = db.sql(
            """
          SELECT task_id, body, runs
          FROM outbox
          ORDER BY created_at
          LIMIT 100
          FOR UPDATE SKIP LOCKED
          """
        ).query { rs, _ ->
            TaskMsg(
                rs.getLong("task_id"),
                json.readValue(rs.getString("body")),
                rs.getInt("runs"),
            )
        }
            .list()

        if (msgs.isEmpty()) return
        for (msg in msgs) pulsar.send(msg)
        // Clear sent ids
        db.sql("DELETE FROM outbox WHERE task_id IN (:ids)")
            .param("ids", msgs.map { msg -> msg.taskId })
            .update()
    }


    /**
     * Inserts task + outbox or finds the existing task
     * Relies on being called from a @Transactional spring function
     */
    private fun insertOrFind(input: CreateTaskBody): InsertResult {
        val body = json.writeValueAsString(input.commands)
        val id = db
            .sql(
                """
            INSERT INTO task (idem_key, body)
            VALUES (:idem_key, :body::jsonb)
            ON CONFLICT (idem_key) DO NOTHING
            RETURNING task_id
            """
            )
            .param("idem_key", input.idemKey)
            .param("body", body)
            .query(Long::class.java)
            .optional().getOrNull()

        //  If the task does not yet exist
        if (id != null) {
            //@TODO - Use actual runs value once implemented
            db.sql(
                """
            INSERT INTO outbox (task_id, body, runs)
            VALUES (:task_id, :body::jsonb, 1000)
            """
            )
                .param("task_id", id)
                .param("body", body)
                .update()
            return InsertResult(id, null)
        } else {
            val (existingId, existingBody) = db
                .sql(
                    """
                SELECT task_id, body
                FROM task
                WHERE idem_key = :idem_key
                """
                )
                .param("idem_key", input.idemKey)
                .query({ rs, _ -> rs.getLong(1) to rs.getString(2) })
                .single()
            return InsertResult(
                existingId,
                json.readValue(existingBody)
            )
        }
    }

    private data class InsertResult(val taskId: Long, val existingCommands: List<String>?)


    /**
     * Inspects the status of a task.
     *
     * 404 - task does not exist
     * Returns APIResponse<{
     *  taskId: number;
     *  complete: boolean;
     * }>
     */
    @GetMapping("/status/{taskId}")
    fun status(@PathVariable @Positive taskId: Long): APIResponse<TaskStatus> {
        val task = db
            .sql(
                """
            SELECT complete_runs, requested_runs
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
     * Loads task run results as an array.
     *
     * 404 - task does not exist
     * Returns APIResponse<any[]>
     */
    @GetMapping("/results/{taskId}")
    fun results(@PathVariable @Positive taskId: Long): APIResponse<List<JsonNode>> {
        val rows = db
            .sql(
                """
            SELECT run.result
            FROM task
            LEFT JOIN run USING (task_id)
            WHERE task.task_id = :taskId
            ORDER BY run.created_at
            """
            )
            .param("taskId", taskId)
            .query(String::class.java)
            .list()

        if (rows.isEmpty())
            throw ResponseStatusException(
                HttpStatus.NOT_FOUND,
                "Task $taskId not found"
            )
        val runs = rows.filterNotNull().map(json::readTree)
        return APIResponse("Retrieved results", runs)
    }
}

data class CreateTaskBody(
    @field:Pattern(regexp = "[A-Za-z0-9]{64}", message = "Invalid idemKey submitted")
    val idemKey: String,
    @field:NotEmpty
    @field:Size(max = 1000)
    val commands: List<@NotBlank @Size(max = 64) String>
)

data class APIResponse<T>(val msg: String, val data: T)
data class TaskId(val taskId: Long)
data class TaskStatus(val taskId: Long, val complete: Boolean)

@PulsarMessage(topic = "tasks")
data class TaskMsg(
    val taskId: Long,
    val commands: List<String>,
    val runs: Int
)

data class JobMsg(
    @field:Positive
    val taskId: Long,
    val runId: UUID,
    val result: JsonNode,
    // If the overall task is complete, instead of counting runs since I will
    // collect all runs, including error runs that get retried
    val complete: Boolean
)
