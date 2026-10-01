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
