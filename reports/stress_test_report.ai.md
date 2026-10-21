# Stress Test Report (run 4, 2026-10-21)

Stack: kong → task-manager → pulsar → 4 quantum-computer workers (384 MB)
→ postgres. Clean slate verified; DB and topics reset before each profile.
Rate = recorded rows ÷ (last − first `run.created_at`). Driver ran 648 s.

## Throughput (runs/s)

| Gates | Baseline | Latency 50 ms | Latency+loss+kills |
|------:|---------:|--------------:|-------------------:|
| 1     | 634      | 70.4          | 60.1 (229/1200)    |
| 10    | 767      | 70.9          | 0 (504)            |
| 100   | 684      | 68.4          | 0 (502)            |
| 1000  | 207      | 60.5          | 0 (502)            |

Baseline used 15k/15k/12k/6k runs per block, latency profiles 1.2k. Every
baseline and latency-only block recorded 100% with 0 errors. Under latency
the ceiling is the worker's blocking per-run `send("results")` (a broker
round trip per run), so gate count barely matters.

## Database after each set

| Set      | Tasks | Runs   | Errors | Dupes | Outbox | MB   |
|----------|------:|-------:|-------:|------:|-------:|-----:|
| Baseline | 16    | 48,000 | 0      | 0     | 0      | 24.4 |
| Latency  | 4     | 4,800  | 0      | 0     | 0      | 9.1  |
| Lat+kill | 1     | 229    | 0      | 0     | 0      | 8.0  |
| Infra    | 10    | 29,958 | 0      | 3,283 | 0      | 17.3 |
| Invalid  | 15    | 5      | 140    | 0     | 0      | 8.0  |

Empty schema is 7.8 MB.

## Container kills

- **Latency + jitter + 1% loss, kill qc-2/qc-3 and task-manager:**
  task-manager did not resume consuming after restart (`results` backlog
  978). Later POSTs got kong 504/502 while it was still booting. The root
  cause of the slow recovery is unconfirmed.
- **Postgres killed 7 s (10 gates, 15k runs):** 387 runs/s, but **42 runs
  were lost permanently**. Outbox and DLQ were both empty. Task-manager
  logged an I/O error during a batch insert and "JDBC rollback failed".
  The likely cause is the results batch being acked after the insert
  failed (unconfirmed).
- **Pulsar killed 5 s:** all 15,000 recorded at 418 runs/s, but p3 ended
  with 3,283 duplicate runs. These are most likely redeliveries of
  unacked messages after the broker restart.

## Invalid submissions

- All 17 malformed bodies were rejected with a bare HTTP 400 and no reason
  given. The cases were unparsable JSON, runs 0, −5, 3001 and string,
  bad idemKey, programId mismatch or uppercase, empty, blank, >64-char
  and 1001 commands, and non-list or null commands.
- Reusing an idemKey returned 201, then 200, then 409 as designed. The 409
  still inserts an orphan program row (16 programs, 15 tasks).
- Invalid programs are accepted (201) and fail in the worker. This covered
  a bad gate, wrong qubit count, a nonsense direction, duplicate,
  out-of-range or negative qubits, lowercase, double spaces and 9-qubit
  gates. Each gives 10/10 error rows with the generic "Invalid program",
  and the DLQ stays at 0. The parser's specific reason is discarded.
  `"0  H forward"` is rejected because of `split(" ")`.

## Errors to fix

1. Runs lost during a postgres outage.
2. Duplicates after a pulsar restart.
3. Task-manager does not recover under a lossy network.
4. Worker throughput collapses under latency because of the blocking send.
5. Invalid programs are only caught by the worker, and the 400 responses
   are opaque.
