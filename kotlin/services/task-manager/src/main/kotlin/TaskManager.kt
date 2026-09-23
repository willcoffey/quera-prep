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
   */
  @GetMapping("/alive")
  fun alive(): Boolean {
    return true
  }
}


// JVM entry point
fun main(args: Array<String>) {
  /** Starts all the magical spring auto-config etc */
	runApplication<TaskManager>(*args)
}
