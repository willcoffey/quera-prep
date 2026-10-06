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

// Database related imports
import org.springframework.jdbc.core.simple.JdbcClient
import kotlin.jvm.optionals.getOrNull

// JVM entry point
fun main(args: Array<String>) {
    /** Starts all the magical spring auto-config etc */
    runApplication<TaskManager>(*args)
}

@SpringBootApplication
class TaskManager

@RestController
class Endpoints(
    private val db: JdbcClient,
    private val json: ObjectMapper
) {
    /**
     * Create a task
     *
     * currently does not verify identical tasks on idempotent key collision.
     * silently returns existing id.
     *
     * Returns
     *    msg : string - Human readable
     *    data
     *      taskId : Long - The id of the task
     */
    @PostMapping("/create")
    fun create(@Valid @RequestBody input: CreateTaskBody): ResponseEntity<APIResponse<TaskId>> {
        /*
         * Insert the new task if it doesn't already exist, returning the id 
         * after postgres generates it. If it does exist already, query for the
         * existing id and return it.
         */
        val id: Long? = db
            .sql(
                """
            INSERT INTO task (idem_key, body)
            VALUES (:idem_key, :body::jsonb)
            ON CONFLICT (idem_key) DO NOTHING
            RETURNING id
            """
            )
            .param("idem_key", input.idemKey)
            .param("body", json.writeValueAsString(input.commands))
            .query(Long::class.java).optional().orElse(null)

        if (id == null) {
            // The record already exists, load it
            val existingId = db
                .sql(
                    """
                  SELECT task_id FROM task WHERE
                  idem_key = :idem_key
                """
                )
                .param("idem_key", input.idemKey)
                .query(Long::class.java).optional().orElse(null)
            if (existingId == null) {
                throw ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Request appeared to be duplicate, but existing record couldn't be found"
                )
            } else {
                return ResponseEntity.status(HttpStatus.OK)
                    .body(
                        APIResponse<TaskId>(
                            msg = "Task previously processed, returning existing id",
                            data = TaskId(existingId)
                        )
                    )
            }
        } else {
            // The record was just added, return its id
            return ResponseEntity.status(HttpStatus.CREATED)
                .body(APIResponse<TaskId>(msg = "Added task to job queue", data = TaskId(id)))
        }
    }

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
            ORDER BY run.run_idx
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
