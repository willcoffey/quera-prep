Some quick notes before readme refactor

This is currently functional, and I don't think I'll do much on it before doing
the frontend. Many things I don't intend to ever do, but want to address as they
are something that would need to be done on real prohect. Namely 

 - dead letter q
 - partial measurement
 - Coraza WAF
 - Auth0 and OIDC
 - Pagination

Some things I do want to do, but not until frontend is done, if I have time.
 - multiple worker instance

## schema refactor
Initially I just wanted to get some messages running, but I don't like the 
current approach. The design would depend on the scale of jobs. My first thought
is

task-manager sends out a single message per job. i.e. a task with 1000 jobs 
sends 1000 messages, each with a UUID. format is { commandId, uuid }.

pulsar distributes messages

quantum-computer buffers some messages. Looks up instructions from task-manager
using commandId, which is a hash of the program string.


My initial reason for not doing this way was scale of messaging and not wanting
to setup the command database yet. If jobs are very small, the overhead of 
sending a message per could get high. but that would just mean they get batched
into, say, sets of 10. still not the full 1000
 
---

The intent of this project is mainly as preparation for a Quera job interview.
To learn their software stack and what the job will likely entail. I also want
to experiment with some AI patterns I've been considering adding to my
workflow.

# The Stack
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
