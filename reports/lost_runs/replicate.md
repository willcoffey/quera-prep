# Prompt: Replicate the 42 lost runs (postgres kill)

## Important - Target 10 minute total run time. Do not fix anything.

You have been started without standard restrictions from this repo's
claude settings, which should allow you full access to the `podman`
network. See `./stress-settings.json` for your current settings.

If not started on a clean slate (empty postgres/pulsar) don't start.

## Background

Read `reports/stress_test_report.ai.md` and the p3 section of
`reports/stress_test_journal.ai.md`. In p3, killing postgres for 7 s during
a 10-gate block of 15,000 runs (5 POSTs x 3000) lost 42 runs permanently.
Outbox and DLQ were empty. Task-manager logged a batch insert I/O error
and "JDBC rollback failed".

Hypothesis: the `results` listener in
`kotlin/services/task-manager/src/main/kotlin/TaskManager.kt`
(`@PulsarListener(... batch = true)`, no subscriptionType) runs on an
Exclusive subscription. Spring Pulsar then acks batches cumulatively. The
failed batch is nacked, and the next successful batch's cumulative ack
covers it before redelivery, so it is never redelivered.

## Goal

Reproduce the loss and gather evidence that confirms or rejects the
hypothesis. Code is write-protected; don't change it or work around it.

1. Before load, confirm the `results` subscription type and record its
   internal stats (`pulsar-admin topics stats` and `stats-internal`:
   markDeletePosition, individuallyDeletedMessages, unacked, redeliver
   counts).
2. Create a second audit subscription on `results`
   (`topics create-subscription -s audit`). Nothing consumes it, so it
   keeps a copy of every result message.
3. Re-run the p3 postgres block 3 times (reset between runs): 10 gates,
   15,000 runs, kill postgres at t+3s, start it at t+10s. Wait for things
   to settle (stall timeout 40 s) and record the count of missing runs.
4. For each lossy run, identify the missing run_ids by task. Dump the audit
   subscription and check whether the missing runs were published to
   `results`. Published but not in DB = acked without insert. Never
   published = the loss is upstream (outbox/worker), so the hypothesis is
   wrong.
5. Capture a task-manager log timeline: the failed batch (exception,
   rollback, nack) and the next successful batch and its ack, with
   message IDs if they're logged. Compare the `results` subscription
   stats with step 1.
6. Control: one run with no kill. Expect 0 lost.

## Output

Keep an append-only `./lost_runs_journal.ai.md` while you work.
Finish with a 300 word `./lost_runs_report.ai.md` that covers the
loss count per run, whether the missing runs reached the `results` topic,
the log/ack timeline, and a verdict on the hypothesis (confirmed, rejected,
or inconclusive, with the reason). Only `*.ai.*` files are editable.

## Tooling notes

Network shaping isn't needed for this test.

Podman network: use `podman exec` for admin access, no exposed ports needed.

    podman exec quera-mirror-pulsar-1 bin/pulsar-admin topics stats \
      persistent://public/default/results
    podman exec quera-mirror-pulsar-1 bin/pulsar-admin topics \
      stats-internal persistent://public/default/results
    podman exec quera-mirror-pulsar-1 bin/pulsar-client consume \
      -s audit -n 0 persistent://public/default/results
    podman exec quera-mirror-postgres-1 psql -U postgres -d task_manager

Logs: `podman logs quera-mirror-task-manager-1` (`.dev/podman.log` may be
stale if the stack wasn't started via dev.ai.sh).

Resets: don't `compose down`, the stack is attached to the user's terminal.
Drop and recreate the `task_manager` database (owner task_manager), then
`podman restart quera-mirror-task-manager-1` to recreate the schema. Delete
the pulsar topics (runs, results, errors, runs-quantum-computer-DLQ) with
`pulsar-admin topics delete -f`. Recreate the audit subscription after
each reset, before load starts.
