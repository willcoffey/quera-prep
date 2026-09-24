# Thu Sep 24 12:58:24 PM EDT 2026
Refactor the kotlin config in preparation of multiple services. Moved gradle 
build stuff to root. Avoid duplication of config in every service.

# Wed Sep 23 07:03:49 PM EDT 2026
Reviewed and cleaned up some of the spring boot initialzer setup. Switching to
first app being task manager.

# Wed Sep 23 03:24:49 PM EDT 2026
`6.12.74+deb13+1-arm64 #1 SMP Debian 6.12.74-2 (2026-03-08)`

 - Installed java sdk - `javac 21.0.12.1`
 - Used spring boot initializer
`https://start.spring.io/#!type=gradle-project-kotlin&language=kotlin&platformVersion=4.1.1&packaging=jar&configurationFileFormat=properties&jvmVersion=21&groupId=com.example&artifactId=demo&packageName=com.example.demo&dependencies=web`
but modified dir structure for services.
updated gradle settings to include hello world dir
