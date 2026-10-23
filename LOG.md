# Fri Oct 23 04:15:26 PM EDT 2026
Ended up branching and giving claude access to patch the services. Would be 
worth reviewing and merging into main, after figuring out the implications of
the change.

Replicating battery drain due to HashedWheelTimer theory
claude created a script to give 

```sh
#!/bin/bash
# battmw.sh: average battery discharge power in mW over 30 s. Read-only, no sudo.
B() { ioreg -rn AppleSmartBattery; }
B | grep -q '"ExternalConnected" = Yes' && { echo "error: unplug the charger" >&2; exit 1; }
for _ in $(seq 30); do
  B | awk -F' = ' '/"Voltage" =/{v=$2} /"Amperage" =/{a=$2} /"InstantAmperage" =/{i=$2}
    END{if(i!="")a=i; print "a="a"; if(a>=2^63) a=a-2^64; s=s+"v"*a; n=n+1"}'
  sleep 1
done | { cat; echo "scale=0; -s/n/1000"; } | bc
```

>> one integer: average battery discharge power over ~30 seconds, in milliwatts

Ran it once with default settings
~16 watts over several tests

Ran it with HashedWheelTimer set to 100ms as only change
~4 watts over several tests

lose ~75% of battery life or 9 hours on my macbook air m3. This is with little
running on the system.

# Fri Oct 23 10:57:03 AM EDT 2026
Replicated the lost runs via additional testing and believe I have the fix.

Cause:
The subscriptin type on the topic is not specified. So it defaults to an 
exclusive subscription.

On a batched consumer, if the subscription type is exclusive, it uses cumulative
acks. This means, instead of sending per message acks, if it processed 10 
messages it only sends 1 ack. It sends cumulative ack for message 10, implying
messages 1-9 completed. This is for all messages in the topic, not restricted
to just the batch.

When postgres is killed, the batch it was processing gets nacked, and pulsar
prepares to resend it later. Postgres comes back up, but the next messages
that the task manager consumer receives is the batch after the batch that 
failed. This batch processes fine, so spring sends a cumulative ack. This tells
pulsar that those messages that failed earlier, and never got resent, have 
been acked.

Solution: Add `subscriptionType = [SubscriptionType.Shared]` to the results 
consumer. This ensures each individual message gets its own ack.

Also add the subscription type to other batched consumers that would have the
same bug but it did't get revealed.

# Tue Oct 20 03:14:28 PM EDT 2026
Time to triage. I'm not going to be getting a full code review in. Need to 
get TaskManager to an acceptable state, then finish other tasks.
 - Get claude to run another perf benchmark
 - Get frontend up and running on github pages
 - Write an explainer for how to use the interface
 - Ensure readme insttructions work on a fresh clone


# Tue Oct 20 03:08:29 PM EDT 2026
Running the podman dev setup kills my battery life and my laptop gets hot. CPU
usage is low. Most likely culprit is interrupts created by pulsar client. 
AI Summary:
```
Cause: the Pulsar Java client (4.2.4) creates a Netty HashedWheelTimer with a 
hard-coded 1ms tick. A HashedWheelTimer ticks at a fixed rate whether or not 
anything is scheduled, so each JVM's "pulsar-timer" thread wakes ~1,130 
times/s. Measured: 4 such threads, one per quantum-computer replica, 
~4,500 wakeups/s total. Fine on servers, bad on a laptop.

Why it matters: CPUs only save real power in deep sleep states, which they 
enter only when idle long enough. Constant 1ms wakeups keep cores in shallow, 
power-hungry states. In a VM each wakeup also exits to the Mac's hypervisor 
and QEMU, so the Mac never rests. It's wasted power, not an app performance 
problem. Node avoids this: its event loop sleeps until the next timer is 
actually due.
```

It's funny, I had a rough time with an interview question on hash wheel timer,
and here it is getting me again.


# Tue Oct 20 12:01:10 PM EDT 2026
Surprised to find that Kotlin resolves classes with the same packagename
so no import is needed. seems like magic. 

---

A very annoying network issue today, not fully diagnosed but got things working.
Initially assumed it part of the refactor / code cleanup but appears unrelated.

 - Working from a cafe where I've previously noticed that it has a small ipv4
DHCP pool along with long lease times, leading to ipv6 only and issues with 
ipv4 addresses.

 - Kong was unable to route to other services, as it's DNS lookups were failing.
The path was something like kong -> aardvark -> qemu dns -> host mac dns. The
surprising thing to me was that kong may be leaking service hostnames via 
dns even though they are inside the same podman network network

It's been intermittent, but absolutely related to having ipv6 nameservers only.

I had ipv4 and ipv6 working, but only ipv6 nameservers and it wouldn't work. I
got it running after adding 1.1.1.1 as a nameserver to my mac, but it wasn't
right away. Went through resetting network and dhcp cache. Didn't start working
again until I connected to phone hotspot and back to wifi. That somehow made
it start functioning again.

However, some fixes to compose.yaml made it work regardless of other settings,
but I wanted to know the root cause. Still need better replication to decide 
that. for now, the settings in compose to fix it are

Listed for similar fixes, keeps the dns internal. Normally kong checks SRV
records first, which I think go up the chain eventually hitting the mac DNS,
which was ipv6 and causing issues.
`KONG_DNS_ORDER: "LAST,A,CNAME"`

In the cloudflared block, force it to use the ipv4 cloudflare dns to establish
the tunnel.
`dns: [1.1.1.1]`


# Mon Oct 19 09:39:50 PM EDT 2026
One thing that has been coming up a lot is all the error catching, dead 
lettering, message parsing and that stuff. Much of it is only there **in case**
something bad makes its way into a topic or a table. 

So much of it simply stems from not noing how much trust I can put into the
schema, how worried I am about poison messages and the like.

There will always be last-mile validation, but a better more explicit boundary
on those two items along with stricter schema enforcement would be good to have.

 - it looks like schema enforcement on pulsar is mostly producer side
   versioning, no actual validation on broker.
 - pulsar functions for parsing and re-publishing on a trusted topic.
 - no way to say `topix_x` is a pur function of `topic_y`

# Sat Oct 17 03:59:16 PM EDT 2026
Roughly benchmarked performance after enabling 4 deploys of quantum-computer. 
AI Tests:
```
Quantum-computer throughput benchmark

Setup
- Host: Linux arm64 VM (QEMU) on Apple Silicon, 4 vCPUs, 6 GB RAM
- Whole stack on the same VM: Kong, task-manager, Postgres, Pulsar standalone, 4x quantum-computer, plus the load generator
- quantum-computer: 4 replicas, each limited to 0.5 CPU / 256 MB (2 cores total), JVM -Xmx128m, SerialGC, C1 JIT only
- Throughput measured end to end: submit tasks -> all results recorded by task-manager

Results
- 3 gates: ~1,500 runs/s, ~2.6 ms per run per replica (~90% overhead)
- 10 gates: 1,091 runs/s, 3.7 ms per run per replica (~72% overhead, ~28% gates)
- 100 gates: 322 runs/s, 12.4 ms per run per replica (~19% overhead, ~81% gates)
- 1000 gates: 39 runs/s, 103.6 ms per run per replica (~2% overhead, ~98% gates)

Model
- Each run costs ~2.3 ms fixed overhead + ~0.1 ms per gate (per replica at 0.5 CPU)
- Gates and overhead are equal at ~23 gates
- Overhead caps throughput at ~1,700 runs/s regardless of program size
- ~0.1 ms per gate is ~100x slower than expected for 8 qubits; simulator is the main bottleneck
```

I checked the typescript sim as compared to kotlin port, kotlin port was only 
1.3x faster.


# Sat Oct 17 03:07:29 PM EDT 2026
EnterWorkTree did not resolve the `.claude/` folder garbage. Replicated what 
causes it.
```
1. Confirm the subdir has no .claude: ls -d kotlin/services/.claude
2. Have Claude run a plain cd (no subshell): cd /abs/path/kotlin/services && pwd
3. ls -a kotlin/services -> .claude/.cc-writes/ now exists
```
I added back the env portion of claude settings. This appears to resolve it.
`"env": { "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1" }`




# Sat Oct 17 02:28:21 PM EDT 2026
Setup some minimal error handling so invalid programs wouldn't be retried. Also
updated max constraint on task runs. No dead letter queue or handling on db
errors for pulsar messages, including duplicate ids that would always error. As
is it shouldn't be a problem but it is fragile.

# Fri Oct 16 04:17:53 PM EDT 2026
Testing if denying "EnterWorkTree" was any reparations on use.


# Fri Oct 16 10:38:30 AM EDT 2026
Pushing change to claude settings for a very annoying harness behaviour. Despite
the sandbox settings, the harness creates a `.claude` setting whenever it goes
inside directories. This breaks the auto-discovered services and also simply
pollutes the whole repo with `.claude` directories wherevere it is working.

Another thing to note, I cannot deny folder creation. By allowing `*.ai.*` 
files, this also allows claude to create nested dirs, like 
`./people/eve/evil.ai.ts` if something is being auto-loaded, that could cause
issues.

`EnterWorkTree` also bypasses permissions, as it is a harness command not 
something the agent does. So despite the deny permissions claude can still 
create the `.claude/` directories wherever.

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
