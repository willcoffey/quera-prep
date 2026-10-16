# Current Summary
Got MVP done, can get interface styled.

---
# Fri Oct 16 10:14:38 AM EDT 2026
Quick fix for memory leak on cache system. Whole thing needs to be cleaned up
as it's pretty ugly, but going to wait till the end when I start looking up
standard practice for style & file structure.


# Thu Oct 15 03:19:53 PM EDT 2026
Added a dead letter queue. Malformed task messages still get retried when they
should just be rejected initially, but at least they get handled for now.

---

Worked through thread safety issue on cache. It's pretty verbose and could be
refactored to be more readable/fewer lines. Really, it could be refactored with
`LinkedHashMap` which is essentially what I built, but I wanted to work through
the problem myself.

Prevented the program id from being removed when network error gets dropped off
the tail. otherwise it would also delete any new id from the hash map.

# Mon Oct 12 09:44:54 PM EDT 2026
Refactoring the backend into a message per run system to simplify things. 

Need to get the programs to the simulator.

# Sat Oct 10 07:46:11 PM EDT 2026
Old claude simply called playwright via bash so I didn't notice the mcp server
wasn't accessible. Updated local `~/.claude.json` to point to the correct
binary and use the playwright folder that bubblewrap allows for cache.
1. Added env to ~/.claude.json
```json
      "env": {
        "PLAYWRIGHT_MCP_EXECUTABLE_PATH": "/home/agent-will/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell",
        "PWTEST_SERVER_REGISTRY": "/home/agent-will/playwright-out/registry"
      }
```


# Tue Oct  6 02:26:45 PM EDT 2026
Got pulsar installed and added a means to expose it to localhost so llm can 
access the broker.

---

Refactored endpoints and have reached an acceptable code style. Long term to 
look into style guides and linters.

Next step is pulsar install and configure, outbox sender, completion endpoint.

# Mon Oct  5 08:25:50 PM EDT 2026
Worked on fleshing out the task creation. Avoided using the DO UPDATE conflict
resolution as it seems hacky.

Code is ugly till I get familiar enough with kotlin style. Also need to define
the command format before I can write a regex to validate it.

Used standard nginx config for doing request size filtering. via kong env 
override

familiarized myself with jakarta validation. which is much better than 
typescript style.

misc dev env changes.



# Sun Oct  4 08:35:34 PM EDT 2026
Did some work on the dev environment as well as getting postgres setup. For the
dev environment, mainly focused on getting the edit loop faster and memory usage
down. Claude made optimizations to the `dev.ai.sh` script and I added JVM memory
limits for the services.

For postgres, the setup is as follows:
a single postgres container that contains per-service databases with per-service
roles. passwords are stored in a gitignored .env file. A postgres init script is
run, only when the volume is initially created. 

# Thu Oct  1 01:04:19 PM EDT 2026
Launching claude in a nested directory inside the repo means it doesn't use the
repo root claude settings. so no sandbox.

# Thu Oct  1 08:29:14 AM EDT 2026
On a flight, no internet and only the Kotlin reference PDF. Let's see what I 
can do.
- need to review my REST stuff. POST vs PUT.
- Build is taking way to long, 34s for build + another like 30s for spring boot
to come up. Not using cache? Also need to document expectations. i.e. old 
service is still up after a compile issue, should be down until fixed.
- Don't have Spring docs, @PostMapping causes error. maybe function needs args?
- A curl request to `/tasks/notAnEndpoint` throws a  
```
{
  "timestamp": "2026-10-01T12:58:57.421Z",
  "status": 404,
  "error": "Not Found",
  "trace": "...",
  "message": "No static resource creates.",
  "path": "/creates"
}
```
with a stack trace. surprised it defaults to exposing this much info.
- I think dev.ai.sh / gradle might be buidling on every change, and not
canceling, leading to massive performance issues when making rapid changes.



Next steps:
postgres setup
endpoints on task-manager service
 - create job
 - job status
 - job results
 - task manager status


# Mon Sep 28 09:43:25 AM EDT 2026
Working on developer experience.
Created a script to handle the podman compose override files, so you can just
get started development with a single command.

Had the script also save a rolling log to `.dev/` but after more work this is 
likely not needed. `podman` already has good options for viewing logs. I'm 
keeping it for now since my current claude setup sandboxes it in such a way that
it can't run commands but can easily read the file.

# Fri Sep 25 02:46:54 PM EDT 2026
Worked through the docker/podman setup enough to have an idea of how I want it
to work. build works. Once multiple services exist either have per-service 
overrides that use bootRun with file watching in the container, or a dev script
that generates these files on request. 

Very little optimization so far, will leave that till I've actually worked with
enough with it to see what the bottlenecks are. Likely a lot of low hanging 
fruit with docker setup. 


# Thu Sep 24 12:58:24 PM EDT 2026
vim setup
coc-kotlin appears deprecated. setting up language server manually.

download and untar the language server
`~/.local/share$ curl -L https://download.jetbrains.com/language-server/kotlin-server/263.4702.0/kotlin-server-263.4702.0-aarch64.tar.gz | tar xz`
add it to the path
`ln -s ~/.local/share/kotlin-server-263.4702.0/bin/intellij-server ~/.local/bin/kotlin-lsp`
update `coc-settings.json` to use the server.
to language server block:
```
"kotlin": {
  "command": "kotlin-lsp",
  "args": ["--stdio"],
  "filetypes": ["kotlin"],
  "rootPatterns": ["settings.gradle.kts", "build.gradle.kts"]
}
```
updated my `.vimrc` to add a format command
`nnoremap <silent> Sk :call CocAction('format')<CR>`

This allows for formatting `.kt` files, but does not work on `.kts` files.
`ktfmt` functions as a standalone formatting tool that doesn't need the language
server. Won't worry about that for now.

---

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
