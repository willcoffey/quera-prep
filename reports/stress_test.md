# Prompt for 400 Word Stress Test Report

## Important - Target 10 minute total run time

You have been started without standard restrictions from this repos
claude settings. which should allow you full access to the `podman`
network.

see `./stress-settings.json` for your current settings.

I have reset both postgres and pulsar volumes and removed the kong 
rate limiter. You are starting at a clean slate. If you are not, 
don't proceed with the test.

The end goal is to produce test results that show:

runs per second at 4 intervals between 1 and 1000 gates per program.
Use this as estimation for times and target 2 minutes per stat block.

read the stress test journal to for a plan to meet target runtime.

database stats after a set of runs. number of records. errors. total
mb of storage.

Reset database and pulsar between runs, allow any messages in the queue to
settle

Run the tests 2 more times with different network profiles. starting with just
latency and killing containers at later stages.

Reset and run a final test where you attemp invalid API submissions. For example
programs with invalid gates. mismatched qubit gate pairs. nonsensical direction.
unparsable etc.

Also run tests where you kill pulsar, postgres containers. 

Write a 400 word report containing this data as well as any errors
that came up during testing. `stress_test_report.md`. Also keep a
`stress_test_journal.md` that you append to with notes so I can read as you
work.

## Tooling notes

Network shaping: `tc` is at `/usr/sbin/tc` (not on PATH) and no container
has it, so run it from the host inside the container's net namespace. The
netem module autoloads, no sudo needed. Rules shape egress only, one
direction per interface. Always `qdisc del` when done.

    PID=$(podman inspect -f '{{.State.Pid}}' quera-mirror-kong-1)
    podman unshare nsenter -t $PID -n /usr/sbin/tc qdisc add dev eth0 \
      root netem delay 100ms
    podman unshare nsenter -t $PID -n /usr/sbin/tc qdisc del dev eth0 root

Podman network: use `podman exec` for admin access, no exposed ports needed.

    podman exec quera-mirror-pulsar-1 bin/pulsar-admin topics list \
      public/default
    podman exec quera-mirror-pulsar-1 curl -s localhost:8080/admin/v2/...
    podman exec quera-mirror-postgres-1 psql -U postgres -d task_manager

Resets: don't `compose down`, the stack is attached to the user's terminal.
Drop and recreate the `task_manager` database (owner task_manager), then
`podman restart quera-mirror-task-manager-1` to recreate the schema. Delete
the pulsar topics (runs, results, errors, runs-quantum-computer-DLQ) with
`pulsar-admin topics delete -f`.
