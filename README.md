The intent of this project is mainly as preparation for a Quera job interview.
To learn their software stack and what the job will likely entail. I also want
to experiment with some AI patterns I've been considering adding to my
workflow.

# The Stack
Coraza WAF
Auth0 and OIDC
Kong gateway
Kotlin / Spring Boot
Pulsar
Docker / Kubernetes
Typescript + React

# AI
I've been toying with the idea of restricting claude to `*.ai.*` files. Claude
only ever commits those, and I never edit the `ai` files. If I follow good
commit habits, even if claude bypasses it's sandbox to mutate non `ai` files it
will still be evident at commit time.

# Steps

# Claude


# Typescript + React
My wheelhouse. Just get something simple up.


Scratchpad
---

# Kotlin
Strongly typed JVM language. Stricter, simpler type system vs typescript. 
Nominal typing vs structural. Multi-threaded vs event loop.

# Spring Boot
A layer on top of spring consisting of opinionated defaults, setup scripts,
developer tools etc.

# Gradle
JVM build tool like npm. Script is kept in repo along with alternate versions
for different platforms. Downloads gradle binary to `~/.gradle` if version
does not currently exist. `gradlew tasks`, `gradlew test`, etc.
