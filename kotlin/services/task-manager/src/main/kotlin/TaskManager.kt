package taskmanager
// Universal spring imports
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

// Input validation
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size

// Annotations for endpoints
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody

//Imports for http and json related processing
import tools.jackson.databind.ObjectMapper
import org.springframework.http.ResponseEntity
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

// Database related imports
import org.springframework.jdbc.core.simple.JdbcClient

/**
 * annotation
 * a constant value attached to the TaskManager class. Can be stripped at
 * compile time. Kinda like doing someFunction.idempotent = true in js.
 *
 * This one:
 * Marks this as the main app class
 */
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
     * silently returns existing key.
     *
     * Returns
     *    msg : string - Human readable
     *    result
     *      id : Long - The id of the task
     */
    @PostMapping("/create")
    fun create(@Valid @RequestBody input: CreateTaskBody): ResponseEntity<CreateTaskResponse> {
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
                  SELECT id FROM task WHERE
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
                        CreateTaskResponse(
                            msg = "Task previously processed, returning existing id",
                            result = CreateTaskResponse.Result(existingId)
                        )
                    )
            }
        } else {
            // The record was just added, return its id
            return ResponseEntity.status(HttpStatus.CREATED)
                .body(CreateTaskResponse(msg = "Added task to job queue", result = CreateTaskResponse.Result(id)))
        }
    }
    //*************************************************************************

    /**
     * Returns
     *  status field from the database
     *  not in database
     */
    @GetMapping("/status")
    fun status(): String {
        // Query the database for status
        return "string"
    }

    @GetMapping("/results")
    fun results(): Boolean {
        // query the db, return result or error
        return true;
    }
}

// JVM entry point
fun main(args: Array<String>) {
    /** Starts all the magical spring auto-config etc */
    runApplication<TaskManager>(*args)
}

data class CreateTaskBody(
    @field:Pattern(regexp = "[A-Za-z0-9]{64}", message = "Invalid idemKey submitted")
    val idemKey: String,
    @field:NotEmpty
    @field:Size(max = 1000)
    val commands: List<@NotBlank @Size(max = 64) String>
)

data class CreateTaskResponse(
    val msg: String,
    val result: Result
) {
    data class Result(val id: Long)
}
