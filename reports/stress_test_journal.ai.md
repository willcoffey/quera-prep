# Stress Test Journal

Append-only notes while the stress test runs. Times are local.

## Setup
- Output files use `.ai.md` suffix (`stress_test_journal.ai.md`,
  `stress_test_report.ai.md`) because repo CLAUDE.md only allows editing
  `*.ai.*` files.
- Clean slate verified: all 6 tables empty (8 KB each), 4 pulsar topics
  present, kong rate limiter commented out in compose.yaml.
- Host: 4 CPU, 5.9 GB RAM, swap ~98% used before start (watch for this).
- `scripts/taskman.create.ai.sh` is stale (no programId/runs, wrong path
  /tasks/create); driver posts to `/tasks/` instead.
- Plan: gate counts 1, 10, 100, 1000. Runs per block sized from
  2.3 ms + 0.1 ms/gate to target ~2 min. Throughput measured from
  run.created_at (first -> last result written).

## Baseline (no shaping) — started 21:59
- Reset OK (topics deleted silently, recreated on client reconnect).
- First monitor died because it started before output files existed; re-armed.
- 1 gate: 50,000/50,000 runs, 0 errors, 492 runs/s over 101.6 s.
  17 POSTs (3000 runs each), avg 41 ms.
- 10 gates: 36,363/36,363, 0 errors, 447 runs/s over 81.3 s (faster than the 3.3 ms/run estimate).
- 100 gates: 9,756/9,756, 0 errors, 434 runs/s over 22.5 s. Estimate (12.3 ms/run) is ~5x pessimistic; per-gate cost looks far below 0.1 ms. Keeping the estimate-based sizes for all profiles so blocks are comparable.
- 1000 gates: 1,173/1,173, 0 errors, 160 runs/s over 7.3 s (short block;
  ramp-up dominates, treat as lower bound).
- DB after baseline: 4 programs, 35 tasks, 97,292 runs, 0 errors,
  **276 duplicate_runs**, 0 outbox, 41.4 MB.
- **Finding: duplicates with no faults injected.** 15 of 35 tasks hit,
  clustered in bursts, each dupe 0.25-0.9 s after the original, and 139 of
  276 have a *different* result, so the run was simulated twice (not a
  results-topic redelivery). Gap is shorter than the worker nack backoff
  (>=1 s), which points at the outbox re-sending a batch (e.g. a
  `sendAsync().join()` failing after the broker accepted it). Not confirmed.
- Reset leaves expected noise in task-manager logs (FATAL terminating
  connection, relation "outbox" does not exist) until restart.
- `.dev/podman.log` is stale (stack not started via dev.ai.sh), using
  `podman logs` instead.

## Profile 1: latency only (netem delay 50ms on kong, task-manager, 4 QCs)
- First attempt: 1-gate block recorded only 4,628/50,000 in 8 min
  (9.7 runs/s); later blocks recorded 0 because they queued behind it.
- **Finding: bottleneck is task-manager's `results` consumer, not the
  workers.** Pulsar stats after: `runs` backlog 0 (workers finished all
  97,292 runs) but `results` backlog 90,491, draining at 16.7 msg/s.
  `recordRun` is a single exclusive listener doing a synchronous
  transaction per message; with 50 ms on the task-manager -> postgres
  link each message costs several round trips.
- 44 duplicates again (no kills yet).
- Changing the driver to measure both: worker rate (results-topic msgIn
  delta) and recorded rate (rows in `run`). Rerunning profile 1.

## Aborted
- Profile 1 rerun aborted by user during the 1-gate block, so it has no
  results. Tests will restart once `recordRun`/`recordError` become batch
  listeners (one `unnest` multi-row insert per batch).
- All processes stopped, netem removed from all 6 containers (qdisc back
  to noqueue). DB and topics still hold the partial p1 data; reset before
  the restart.
- Driver/reset/netem/chaos/invalid-submission scripts are in the session
  scratchpad, ready to rerun.

## Duplicate runs: root cause (post-abort investigation)
- **Workers are being OOM-killed.** `podman inspect`: OOMKilled=true,
  RestartCount qc-1 41, qc-2 10, qc-3 63, qc-4 39. Current RSS 215-255 MB
  of a 256 MB limit (`-Xmx128m` heap + metaspace/direct/threads doesn't
  fit). qc-3/qc-4 crash-looped every ~10 s (8 s boot, ~2 s of work) from
  02:00:27 UTC onward; qc-2 died ~02:03:52.
- Restart times minus the ~8 s boot match the duplicate bursts:
  qc-3 kill ~02:00:27 -> burst 02:00:26; ~02:00:48 -> 02:00:49;
  qc-4 ~02:02:15 -> 02:02:14; qc-3 ~02:02:26 -> 02:02:25/27, etc.
- Mechanism: the worker sends the result, then acks. Acks are grouped
  (`acknowledgementsGroupTimeMicros=100000`), so when the worker is killed,
  runs it already finished but hadn't acked are redelivered to another
  worker and simulated again. That explains a different result, the
  sub-second gap (consumer-disconnect redelivery has no nack backoff) and
  bursts of 5-35 (~100 ms of acks at that rate).
- **Correction:** my earlier outbox guess was wrong. The `drainOutbox`
  path only deletes rows whose `sendAsync().join()` succeeded, it runs on
  one scheduler thread and no send failures were logged.
- Impact: baseline throughput is understated, since for most of it only
  ~2 of 4 workers were alive.

---
# Restart (batched recordRun) — 2026-10-20 23:0x

## Setup
- Clean slate verified: 6 tables empty, 4 topics, containers up ~1 min,
  QC memory limit now 384M (RestartCount 0), `recordRun` batch listener
  deployed. `recordError` is still per-message.
- Prior session's scripts were lost with its scratchpad; rewrote one driver
  (`stress.py`). To hit the 10-minute total, blocks target ~20 s, not 2 min:
  1 gate 21k runs, 10 gates 21k, 100 gates 15k, 1000 gates 6k (3000/POST,
  4 concurrent). Rate = recorded rows / (max-min run.created_at).
- netem on kong, task-manager, qc-1..4 (egress). Block gives up after 25 s
  with no progress or 150 s total.

## p0: baseline, no shaping — started 23:06:26
- reset done, api up=True
- 1 gates: 21000/21000 recorded, 0 errors, **820.7 runs/s** over 25.6 s (wall 27.8 s), POSTs {201: 7} avg 89 ms
- 10 gates: 21000/21000 recorded, 0 errors, **899.0 runs/s** over 23.4 s (wall 25.6 s), POSTs {201: 7} avg 37 ms
- 100 gates: 15000/15000 recorded, 0 errors, **807.5 runs/s** over 18.6 s (wall 19.2 s), POSTs {201: 5} avg 44 ms
- 1000 gates: 6000/6000 recorded, 0 errors, **352.7 runs/s** over 17.0 s (wall 19.2 s), POSTs {201: 2} avg 38 ms
- DB after p0: {'programs': 4, 'tasks': 21, 'runs': 63000, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 29.5}

## p1: latency: netem delay 50ms — started 23:09:13
- reset done, api up=True
- 1 gates: 10890/21000 recorded, 0 errors, **73.0 runs/s** over 149.2 s (wall 151.1 s), POSTs {201: 7} avg 488 ms
- 10 gates: 0/21000 recorded, 0 errors, **0 runs/s** over 0.0 s (wall 26.3 s), POSTs {201: 7} avg 458 ms
- 100 gates: 0/15000 recorded, 0 errors, **0 runs/s** over 0.0 s (wall 26.0 s), POSTs {201: 5} avg 428 ms
- 1000 gates: 0/6000 recorded, 0 errors, **0 runs/s** over 0.0 s (wall 26.1 s), POSTs {201: 2} avg 613 ms
- DB after p1: {'programs': 4, 'tasks': 21, 'runs': 16723, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 14.5}

## p2: latency+jitter+loss: delay 50ms 20ms, loss 1% — started 23:13:52
- reset done, api up=True
- 1 gates: 10350/21000 recorded, 0 errors, **69.6 runs/s** over 148.7 s (wall 150.9 s), POSTs {201: 7} avg 466 ms
- 10 gates: 0/21000 recorded, 0 errors, **0 runs/s** over 0.0 s (wall 27.1 s), POSTs {201: 7} avg 475 ms
- 100 gates: 0/15000 recorded, 0 errors, **0 runs/s** over 0.0 s (wall 26.5 s), POSTs {201: 5} avg 414 ms
- 1000 gates: 0/6000 recorded, 0 errors, **0 runs/s** over 0.0 s (wall 26.7 s), POSTs {201: 2} avg 612 ms
- DB after p2: {'programs': 4, 'tasks': 21, 'runs': 15827, 'errors': 0, 'dupes': 0, 'outbox': 8000, 'mb': 18.0}

## Diagnosis after p1/p2
- **Latency bottleneck moved to the workers, not the recorder.** Pulsar
  after p2: `runs` backlog 4,946 (4 consumers), `results` backlog 115. The
  batched `recordRun` keeps up; the worker's `pulsar.send("results")` is a
  blocking send per run, so each run pays a broker round trip (~58 ms per
  run per worker → ~70 runs/s total). The projection of "near-baseline"
  under latency assumed only the recorder paid the delay.
- p1/p2 10/100/1000-gate blocks recorded 0 because they queued behind the
  unfinished 1-gate block (FIFO on `runs`).
- p2 left 8,000 rows in `outbox` at the end (1% loss slowing outbox
  publishes); drained to 0 after netem was removed.
- For p3/p4: BLOCK_RUNS=3000 per gate count so every block finishes.

## p3: latency + kill 1 worker (qc-3 killed t+5s, started t+15s) — started 23:18:40
- reset done, api up=True
  - t+5s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+15s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 1 gates: 3000/3000 recorded, 0 errors, **50.2 runs/s** over 59.7 s (wall 63.0 s), POSTs {201: 1} avg 522 ms
  - t+5s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+15s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 10 gates: 3000/3000 recorded, 0 errors, **81.0 runs/s** over 37.1 s (wall 39.4 s), POSTs {201: 1} avg 490 ms
  - t+5s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+15s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 100 gates: 3000/3000 recorded, 0 errors, **81.8 runs/s** over 36.7 s (wall 39.5 s), POSTs {201: 1} avg 394 ms
  - t+5s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+15s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 1000 gates: 3000/3000 recorded, 0 errors, **66.4 runs/s** over 45.2 s (wall 48.4 s), POSTs {201: 1} avg 551 ms
- DB after p3: {'programs': 4, 'tasks': 4, 'runs': 12000, 'errors': 0, 'dupes': 15, 'outbox': 0, 'mb': 10.8}

## p4: latency + kill 2 workers and task-manager — started 23:22:28
- reset done, api up=True
  - t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+8s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+16s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+20s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+20s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 1 gates: 3000/3000 recorded, 0 errors, **56.0 runs/s** over 53.5 s (wall 56.7 s), POSTs {201: 1} avg 581 ms
  - t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+8s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+16s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+20s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+20s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 10 gates: 3000/3000 recorded, 0 errors, **46.2 runs/s** over 65.0 s (wall 67.5 s), POSTs {201: 1} avg 517 ms
  - t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+8s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+16s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+20s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+20s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 100 gates: 3000/3000 recorded, 0 errors, **60.3 runs/s** over 49.8 s (wall 52.7 s), POSTs {201: 1} avg 536 ms
  - t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  - t+8s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+16s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  - t+20s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  - t+20s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 1000 gates: 3000/3000 recorded, 0 errors, **59.6 runs/s** over 50.3 s (wall 54.7 s), POSTs {201: 1} avg 651 ms
- DB after p4: {'programs': 4, 'tasks': 4, 'runs': 12000, 'errors': 0, 'dupes': 35, 'outbox': 0, 'mb': 12.1}

## Invalid submissions — started 23:30:00
- reset done, api up=True
- API `unparsable JSON`: HTTP 400 '{"timestamp":"2026-10-21T03:31:14.981Z","status":400,"error":"Bad Request","path":"/"}'
- API `missing runs`: HTTP 400 '{"timestamp":"2026-10-21T03:31:14.987Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs=0`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.080Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs=3001`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.088Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs=-5`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.094Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs as string`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.099Z","status":400,"error":"Bad Request","path":"/"}'
- API `bad idemKey (short)`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.106Z","status":400,"error":"Bad Request","path":"/"}'
- API `programId mismatch`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.136Z","status":400,"error":"Bad Request","path":"/"}'
- API `programId uppercase hex`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.143Z","status":400,"error":"Bad Request","path":"/"}'
- API `empty commands`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.147Z","status":400,"error":"Bad Request","path":"/"}'
- API `blank command`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.153Z","status":400,"error":"Bad Request","path":"/"}'
- API `command > 64 chars`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.158Z","status":400,"error":"Bad Request","path":"/"}'
- API `1001 commands`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.173Z","status":400,"error":"Bad Request","path":"/"}'
- API `commands not a list`: HTTP 400 '{"timestamp":"2026-10-21T03:31:15.178Z","status":400,"error":"Bad Request","path":"/"}'
- idemKey reuse: first 201, same program 200, different program 409
- worker `invalid gate`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `CNOT with 1 qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `H with 2 qubits`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `nonsensical direction`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `duplicate qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `qubit out of range`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `negative qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `non-numeric qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `too few tokens`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `lowercase gate`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `extra spaces`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `valid then invalid`: HTTP 201, runs|errors|message = 0|10|Invalid program
- DLQ msgInCounter: 0
- DB after invalid: {'programs': 14, 'tasks': 13, 'runs': 1, 'errors': 120, 'dupes': 0, 'outbox': 0, 'mb': 8.0}

## Notes after p3/p4/invalid
- Kills produced duplicates exactly as predicted by the unacked-redelivery
  mechanism: p3 15 dupes (1 worker kill per block), p4 35 (2 workers).
  No duplicates in p0-p2 now that QCs no longer OOM (RestartCount stayed 0).
- Killing task-manager for 8 s lost nothing: all 12,000 runs recorded,
  outbox 0. Its log errors are only reset noise (`relation "outbox" does
  not exist`, 531x; 8x connection terminated), no errors during load.
- Invalid API input: every bad body gets a bare 400 with no reason (Spring
  hides validation messages). idemKey reuse 201/200/409 as designed.
- Invalid programs are accepted (201) and fail per-run in the worker with
  the generic "Invalid program": 10 error rows per 10-run task, DLQ 0. The
  parser's specific reason is discarded.
- `"0  H forward"` (double space) is rejected: `split(" ")` yields an empty
  token → invalid qubit. Probably should `split(Regex("\\s+"))`.
- 14 programs vs 13 tasks after invalid: the 409 idemKey-conflict
  submission still inserted its program row (orphan program).
- netem removed from all 6 containers (qdisc noqueue). All containers up.

---
# Run 3 — 2026-10-21 (aborted at preflight)
- Not a clean slate: every quera-mirror container (kong, postgres, pulsar,
  task-manager, qc-1..4, frontend, cloudflared) was Exited (137/0) ~1 min
  before start, so DB/topics couldn't be checked. Per prompt, not
  proceeding; stack is the user's to restart (no `compose up` from here).

---
# Run 4 — 2026-10-21 (started from stress_test.md)

## Setup
- Clean slate verified: stack up ~1 min, 6 tables empty (DB 7.9 MB), 4
  topics with 0 msgIn/backlog, kong limiter commented out, QC limit 384M,
  RestartCount 0.
- Workers still do a blocking `pulsar.send("results")` per run, so latency
  profiles are expected to be ~70 runs/s; latency blocks sized 1,200 runs
  (~17 s) so every block finishes. Baseline blocks 15k/15k/12k/6k.
- Rewrote driver (scratchpad `stress.py`, prior one was lost). Profiles:
  p0 baseline; p1 delay 50ms; p2 delay 50ms±20ms + 1% loss + kill
  qc-2/qc-3/task-manager; p3 kill postgres, then pulsar (no shaping);
  invalid submissions. Reset (drop DB + delete topics + restart TM) before
  each.
- 
## p0: baseline, no shaping — started 00:21:59
- reset done, api up=True, db={'programs': 0, 'tasks': 0, 'runs': 0, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 7.8}
- 1 gates: 15000/15000 recorded, 0 errors, **634.0 runs/s** over 23.7 s (wall 26.6 s), POSTs {201: 5} avg 174 ms
- 10 gates: 15000/15000 recorded, 0 errors, **766.6 runs/s** over 19.6 s (wall 20.5 s), POSTs {201: 5} avg 88 ms
- 100 gates: 12000/12000 recorded, 0 errors, **684.1 runs/s** over 17.5 s (wall 18.0 s), POSTs {201: 4} avg 79 ms
- 1000 gates: 6000/6000 recorded, 0 errors, **207.1 runs/s** over 29.0 s (wall 29.4 s), POSTs {201: 2} avg 62 ms
- DB after p0: {'programs': 4, 'tasks': 16, 'runs': 48000, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 24.4}
- Pulsar after p0: {'runs': {'in': 48000, 'backlog': 0}, 'results': {'in': 48000, 'backlog': 0}, 'errors': {'in': 0, 'backlog': 0}, 'runs-quantum-computer-DLQ': {'in': 0, 'backlog': 0}}
- 
## p1: latency only: netem delay 50ms — started 00:24:11
- reset done, api up=True, db={'programs': 0, 'tasks': 0, 'runs': 0, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 7.8}
- 1 gates: 1200/1200 recorded, 0 errors, **70.4 runs/s** over 17.1 s (wall 19.7 s), POSTs {201: 1} avg 555 ms
- 10 gates: 1200/1200 recorded, 0 errors, **70.9 runs/s** over 16.9 s (wall 18.3 s), POSTs {201: 1} avg 371 ms
- 100 gates: 1200/1200 recorded, 0 errors, **68.4 runs/s** over 17.5 s (wall 18.8 s), POSTs {201: 1} avg 322 ms
- 1000 gates: 1200/1200 recorded, 0 errors, **60.5 runs/s** over 19.8 s (wall 21.1 s), POSTs {201: 1} avg 478 ms
- DB after p1: {'programs': 4, 'tasks': 4, 'runs': 4800, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 9.1}
- Pulsar after p1: {'runs': {'in': 4800, 'backlog': 0}, 'results': {'in': 4800, 'backlog': 0}, 'errors': {'in': 0, 'backlog': 0}, 'runs-quantum-computer-DLQ': {'in': 0, 'backlog': 0}}
- 
## p2: delay 50ms 20ms + loss 1%, kill qc-2/qc-3 t+4s and task-manager t+6s, restart t+14s — started 00:26:09
- reset done, api up=True, db={'programs': 0, 'tasks': 0, 'runs': 0, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 7.8}
  t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  t+6s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+14s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 1 gates: 229/1200 recorded, 0 errors, **60.1 runs/s** over 3.8 s (wall 32.1 s), POSTs {201: 1} avg 560 ms
  t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  t+6s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+14s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 10 gates: 0/0 recorded, 0 errors, **0.0 runs/s** over 0.0 s (wall 60.1 s), POSTs {504: 1} avg 60006 ms, failures ['{\n  "message":"The upstream server is timing out",\n  "request_id":"1e0c600c30f4fd4c8e3cd25548578630"\n}']
  t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  t+6s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+14s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 100 gates: 0/0 recorded, 0 errors, **0.0 runs/s** over 0.0 s (wall 14.5 s), POSTs {502: 1} avg 3327 ms, failures ['{\n  "message":"An invalid response was received from the upstream server",\n  "request_id":"45ae0636f922971dc2386b02b97e2']
  t+4s `podman kill quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+4s `podman kill quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
  t+6s `podman kill quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-task-manager-1` -> quera-mirror-task-manager-1
  t+14s `podman start quera-mirror-quantum-computer-2` -> quera-mirror-quantum-computer-2
  t+14s `podman start quera-mirror-quantum-computer-3` -> quera-mirror-quantum-computer-3
- 1000 gates: 0/0 recorded, 0 errors, **0.0 runs/s** over 0.0 s (wall 42.1 s), POSTs {502: 1} avg 42015 ms, failures ['{\n  "message":"An invalid response was received from the upstream server",\n  "request_id":"57d76d743cef486fc45851557ba02']
- DB after p2: {'programs': 1, 'tasks': 1, 'runs': 229, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 8.0}
- Pulsar after p2: {'runs': {'in': 1200, 'backlog': 0}, 'results': {'in': 1207, 'backlog': 978}, 'errors': {'in': 0, 'backlog': 0}, 'runs-quantum-computer-DLQ': {'in': 0, 'backlog': 0}}
- 
## p3: infra kills, no shaping — started 00:29:19
- reset done, api up=True, db={'programs': 0, 'tasks': 0, 'runs': 0, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 7.8}
- postgres block: kill postgres t+3s, start t+10s
  t+3s `podman kill quera-mirror-postgres-1` -> quera-mirror-postgres-1
  t+10s `podman start quera-mirror-postgres-1` -> quera-mirror-postgres-1
- 10 gates: 14958/15000 recorded, 0 errors, **387.3 runs/s** over 38.6 s (wall 79.9 s), POSTs {201: 5} avg 155 ms
- pulsar block: kill pulsar t+3s, start t+8s
  t+3s `podman kill quera-mirror-pulsar-1` -> quera-mirror-pulsar-1
  t+8s `podman start quera-mirror-pulsar-1` -> quera-mirror-pulsar-1
- 10 gates: 15000/15000 recorded, 0 errors, **417.7 runs/s** over 35.9 s (wall 36.7 s), POSTs {201: 5} avg 116 ms
- DB after p3: {'programs': 2, 'tasks': 10, 'runs': 29958, 'errors': 0, 'dupes': 3283, 'outbox': 0, 'mb': 17.3}
- Pulsar after p3: {'runs': {'in': 4203, 'backlog': 0}, 'results': {'in': 14996, 'backlog': 0}, 'errors': {'in': 0, 'backlog': 0}, 'runs-quantum-computer-DLQ': {'in': 0, 'backlog': 0}}
- 
## Invalid submissions — started 00:31:57
- reset done, api up=True, db={'programs': 0, 'tasks': 0, 'runs': 0, 'errors': 0, 'dupes': 0, 'outbox': 0, 'mb': 7.8}
- API `unparsable JSON`: HTTP 400 '{"timestamp":"2026-10-21T04:32:22.977Z","status":400,"error":"Bad Request","path":"/"}'
- API `not an object`: HTTP 400 '{"timestamp":"2026-10-21T04:32:22.982Z","status":400,"error":"Bad Request","path":"/"}'
- API `missing runs`: HTTP 400 '{"timestamp":"2026-10-21T04:32:22.986Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs=0`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.072Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs=3001`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.079Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs=-5`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.085Z","status":400,"error":"Bad Request","path":"/"}'
- API `runs as string`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.093Z","status":400,"error":"Bad Request","path":"/"}'
- API `bad idemKey (short)`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.101Z","status":400,"error":"Bad Request","path":"/"}'
- API `idemKey with symbols`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.109Z","status":400,"error":"Bad Request","path":"/"}'
- API `programId mismatch`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.154Z","status":400,"error":"Bad Request","path":"/"}'
- API `programId uppercase hex`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.161Z","status":400,"error":"Bad Request","path":"/"}'
- API `empty commands`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.167Z","status":400,"error":"Bad Request","path":"/"}'
- API `blank command`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.173Z","status":400,"error":"Bad Request","path":"/"}'
- API `command > 64 chars`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.179Z","status":400,"error":"Bad Request","path":"/"}'
- API `1001 commands`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.194Z","status":400,"error":"Bad Request","path":"/"}'
- API `commands not a list`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.199Z","status":400,"error":"Bad Request","path":"/"}'
- API `null commands`: HTTP 400 '{"timestamp":"2026-10-21T04:32:23.204Z","status":400,"error":"Bad Request","path":"/"}'
- idemKey reuse: first 201, same program 200, different program 409
- worker `invalid gate`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `CNOT with 1 qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `H with 2 qubits`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `nonsensical direction`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `duplicate qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `qubit out of range`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `negative qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `non-numeric qubit`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `too few tokens`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `lowercase gate`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `extra spaces`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `valid then invalid`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `gate only, no qubits`: HTTP 201, runs|errors|message = 0|10|Invalid program
- worker `CCCCCCCCZ (9 qubits)`: HTTP 201, runs|errors|message = 0|10|Invalid program
- DB after invalid: {'programs': 16, 'tasks': 15, 'runs': 5, 'errors': 140, 'dupes': 0, 'outbox': 0, 'mb': 8.0}
- Pulsar after invalid: {'runs': {'in': 145, 'backlog': 0}, 'results': {'in': 5, 'backlog': 0}, 'errors': {'in': 140, 'backlog': 0}, 'runs-quantum-computer-DLQ': {'in': 0, 'backlog': 0}}
- driver finished in 648 s

## Notes after run 4
- Total driver time 648 s (target 600).
- Baseline is ~15-25% below run 3's p0 (634-767 vs 807-899 runs/s at
  1-100 gates). Same code and host; likely host load/swap. Not investigated.
- Latency-only now completes every block: ~70 runs/s flat for 1-100 gates,
  60 at 1000. Confirms the blocking per-run worker `send` is the ceiling.
- p2 broke down: only 229/1200 of the first block recorded, `results`
  backlog 978 at the end, so task-manager was not consuming after its
  t+14s restart. Later blocks got kong 504 (60 s) and 502s because the
  chaos schedule killed task-manager again each block while it was still
  booting under 50ms±20ms + 1% loss. Root cause of the slow/failed
  recovery not confirmed; the killed instance's logs weren't retrievable.
- p3 postgres kill: **42 runs permanently lost** (14,958/15,000; stall
  timeout 40 s, still missing at end, outbox 0, DLQ 0). TM logged a batch
  insert I/O error + "JDBC rollback failed". Suspect the results batch was
  acked despite the failed insert. Unconfirmed.
- p3 total **3,283 duplicate_runs**. Not split per block (DB reset before
  I checked); most likely the pulsar restart redelivering unacked
  runs/results across all consumers.
- Invalid input: unchanged from run 3. 17 bad bodies -> bare 400; 14
  invalid programs accepted 201, each 10/10 error rows "Invalid program",
  DLQ 0; 16 programs vs 15 tasks (409 still inserts an orphan program).
- netem removed from all 6 containers in the driver's `finally`.
