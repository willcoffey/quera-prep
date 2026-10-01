package taskmanager

/**
 * Framework imports. will be part of any service.
 * global gradle cache, should be in ~/.gradle/
 * Maven is a build tool like gradle, but also a registry of packages. 
 * gradle pulls from Maven Central.
 *
 * dependencies in build.gradle.kts
 * 
 */
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/** Specific imports for rest stuff */
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
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
class Endpoints {
  /**
   * Expose this function to /alive path. typical pattern is to return a 
   * data class, which is similar to returning JSON object
   *
   * @TODO - Remove this initial test function after reviewing actuator and 
   * standard monitoring functions
   */
  @GetMapping("/alive")
  fun alive(): Boolean {
    return true
  }

  /**
   * Create a task.
   * This should:
   *  require an idempotent key defined by the client
   *  return a task id that can be used to query status
   *  add the task to a jobs queue
   */
  @GetMapping("/create")
  fun create() : String {
    val input = CreateTaskBody("placeholder", listOf(
      "SELECT 1",
      "H",
      "SELECT 1 2 3",
      "CNOT",
      "SELECT 3 2",
      "T"
    ))

    // Check the idempotence key, how to handle idempotence key?
    // make it use date.now(), reject anything that has an old enough key and
    // just keep it in memory?
    
    // Put the task into the postgres, have postgres generate the task id
    // Return to user
    return input.toString()
  }

  /**
   * Check the status of a task
   * status should be one of
   *  queued
   *  in progress
   *  complete
   *  canceled
   *  unknown id
   */
  @GetMapping("/status")
  fun status() : String {
    // query the db, return the result
    return "string"
  }

  @GetMapping("/results")
  fun results() : Boolean {
    // query the db, return result or error
    return true;
  }
}


// JVM entry point
fun main(args: Array<String>) {
  /** Starts all the magical spring auto-config etc */
	runApplication<TaskManager>(*args)
}

data class CreateTaskBody (
  val idem_key: String,
  val commands: List<String>
)

