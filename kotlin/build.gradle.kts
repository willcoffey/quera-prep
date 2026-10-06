/**
 * Specify the plugins for this project
 *
 * apply false means that it only resolves and downloads, application is done
 * on a per-service level.
 *
 * format is a function chain e.g.
 *
 * kolin("jvm").version("2.3.21").apply(false)
 *
 * function vs value determined by order
 */
plugins {
  // Compiles kotlin code to bytecode
	kotlin("jvm") version "2.3.21" apply false
  // Kotlin does not allow extending classes by default, this opens them 
  // such that spring can extend them in accordance with annotations such
  // as @RestController
	kotlin("plugin.spring") version "2.3.21" apply false
  // Runs the app
	id("org.springframework.boot") version "4.1.1" apply false
	id("io.spring.dependency-management") version "1.1.7" apply false
}

/**
 * Apply these settings to all subprojects in services
 *
 * subprojects are known because they are specified in the 
 * settings.gradle.kts file
 */
project(":services").subprojects {
  apply(plugin = "org.jetbrains.kotlin.jvm")
  apply(plugin = "org.jetbrains.kotlin.plugin.spring")
  apply(plugin = "org.springframework.boot")
  apply(plugin = "io.spring.dependency-management")
  // ensure consistant naming of the output jar
  tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveFileName = "service.jar"
  }

configure<JavaPluginExtension> {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}
configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property", "-Xemit-jvm-type-annotations")
	}
}

/**
 * Where deps are pulled from, like the npm registry
 */
repositories {
	mavenCentral()
}

/**
 * needed to add quotes to functions like implementation, since apply is false.
 * this means the root project is not a spring project, has none of the helpers
 * that would be created as part of the apply process
 */
dependencies {
	"implementation"("org.springframework.boot:spring-boot-starter-webmvc")
	"implementation"("org.jetbrains.kotlin:kotlin-reflect")
	"implementation"("tools.jackson.module:jackson-module-kotlin")
  "implementation"("org.springframework.boot:spring-boot-starter-jdbc")
  "implementation"("org.springframework.boot:spring-boot-starter-validation")
  "implementation"("org.springframework.boot:spring-boot-starter-pulsar")
	"testImplementation"("org.springframework.boot:spring-boot-starter-webmvc-test")
	"testImplementation"("org.jetbrains.kotlin:kotlin-test-junit5")
	"testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
  "developmentOnly"("org.springframework.boot:spring-boot-devtools")
  "runtimeOnly"("org.postgresql:postgresql")
}


tasks.withType<Test> {
	useJUnitPlatform()
}
}

