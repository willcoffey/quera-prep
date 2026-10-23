# Lost Runs Journal

## Preflight — 2026-10-23
- Prompt file is `replicate.md` (no `replication.md` exists).
- Clean slate verified: 6 tables empty, 4 topics msgIn 0 / backlog 0.
- `results` sub `task-manager` type **Exclusive** (no subscriptionType on
  the batch listener). `runs` Shared; `errors`, DLQ Exclusive.
- Original p3 driver (`stress.py`) was lost; writing a new one in the
  scratchpad. Load: 10-gate program, 5 POSTs x 3000 runs, concurrent.
- Adding a second audit sub on `runs` (`audit-runs`) as well as `audit`
  on `results`, so missing run_ids can be found (outbox rows are deleted
  once sent, so the DB has no record of requested run_ids).

## kill1 — started 14:51:51 UTC
- Reset OK, subs: results {task-manager Exclusive, audit}, runs
  {quantum-computer Shared, audit-runs}. Kill pg t+3s, start t+10s.
- POSTs 5x201. **15000/15000 recorded, 0 lost**, settled 48.6 s.
  dupes 978, errors 0, outbox 0. audit (results) 16000 msgs.
- Cursor: only 30 runs recorded before kill; markDelete held at 10:29
  through the outage (backlog 970, unacked 0), then advanced normally.
- Driver bug: `runs` dump used msgBacklog, which counts batched entries
  (3399), not messages. Switched to topic msgInCounter.

## kill2 — started 14:54:01 UTC (load 14:54:35, kill 14:54:38)
- POSTs 5x201. **14910/15000, 90 lost**, all task 1. dupes 0, errors 0,
  outbox 0, DLQ 0. Stalled 40 s at 14910.
- Audit: `runs` 15000 msgs, `results` 15000 msgs. **All 90 missing
  run_ids were published to `results`**; they are audit positions
  1651-1740 (contiguous, = ledger entries 21:1651-21:1740), published
  t+2.94-3.05 s, i.e. the batch in flight at the kill.
- Cursor (1 s samples): markDelete 21:1650 through the outage (runs=1651
  in DB), readPosition 21:2500. At t+14.5 markDelete 21:4599, never any
  individuallyDeletedMessages, unacked 0. Final markDelete 21:14999,
  msgOutCounter 15000 (= no redelivery at all).
- TM log, listener thread `ntainer#0-0-C-1`:
  - 14:54:38.315 Hikari conn broken SQLSTATE 08006
  - 14:54:38.324 TransactionInterceptor "Application exception
    overridden by rollback exception": BatchUpdateException on
    `INSERT INTO run` (recordRun TaskManager.kt:239), I/O error / broken
    pipe.
  - next successful batch: not logged (no ack/message-id logging), but
    markDelete passes 21:1740 by t+14.5 s.
  - **14:55:38.368 NegativeAcksTracker "90 messages will be
    re-delivered"** — exactly 60 s (default nack delay) after the
    failure, by which time markDelete was already past them. Nothing was
    redelivered (msgOutCounter 15000, DB unchanged).
- kill1 had 0 lost: only 30 runs recorded by t+3, the listener seemingly
  wasn't mid-insert at the kill (no recordRun exception logged).

## kill3 — started 14:56:44 UTC (kill 14:57:21)
- POSTs 5x201. **14920/15000, 80 lost**, all task 4. dupes 1000 (runs
  re-sent by outbox drain; `runs` and `results` audit both 16000 msgs).
- **All 80 missing were published to `results`**, audit positions
  1739-1818 contiguous, published t+2.99-3.09 s.
- markDelete held at 32:1738 during outage, jumped to 32:5411 by t+14.8;
  no individuallyDeletedMessages, unacked 0. Final 32:15999,
  msgOutCounter 16000 = msgIn (no redelivery).
- Log: 14:57:21.034 listener `ntainer#0-0-C-1` TransactionInterceptor
  rollback exception on recordRun; 14:58:21.082 NegativeAcksTracker
  "80 messages will be re-delivered" (60 s later). Never arrived.

## control (no kill) — started 14:58:53 UTC
- POSTs 5x201. **15000/15000, 0 lost**, 0 dupes, settled 19.5 s.
  Audit results 15000 / runs 15000; no listener errors, no nacks.

## kill1 revisited
- kill1 *did* hit the bug: listener recordRun failed 14:52:19.79 and
  NegativeAcksTracker logged "22 messages will be re-delivered" at
  14:53:19.887. Failed batch = audit positions 30-51.
- Masked: drainOutbox sent the first 1000 runs but its DELETE failed in
  the outage, so they were re-sent and re-run (audit has 1000 duplicate
  result msgs, first at pos 1000). All of positions 30-59 reappear later.
  978 duplicate_runs + 22 fresh inserts = 1000. So 22 lost, 22 recovered
  by accident.
- Total wall time 14:51:51-15:00:00 ≈ 8 min.

## Fix verification — 2026-10-23
- Fix applied: `results`, `errors`, DLQ listeners now
  `subscriptionType = Shared` (individual acks, no cumulative ack).
- Clean slate verified: 5 tables empty, topics msgIn 0. Live subs:
  results/task-manager **Shared**, errors/task-manager Shared.
- Reusing the earlier driver. Stall timeout raised 40 s -> 90 s: the
  nack redelivery delay is 60 s, so a 40 s stall would count a batch
  that is still pending redelivery as lost. TM log now saved per run.

## fix1 (kill) — 15:49 UTC
- **15000/15000, 0 lost**, dupes 1000 (outbox re-send), settled 64.3 s.
- Listener recordRun rollback 15:50:56.46 (`ntainer#0-0-C-1`).
- Cursor: markDelete held 10:165 with idm `(10:202..10:15999]` and
  unacked 37 — individual acks, the failed batch left as a hole.
  Runs stuck at 14963 until 15:51:56.57 NegativeAcksTracker "37 messages
  will be re-delivered", then 15000, markDelete 10:15999.
- Not masked: the 37 run_ids (audit pos 166-202) never reappear later
  in `results`, so redelivery alone filled the gap.

## fix2 (kill)
- **15000/15000, 0 lost**, dupes 1000. One listener rollback; markDelete
  held 21:1356, runs stuck at 14944 until the nack at 15:54:10.5
  ("56 messages"), then 15000 at t+63.8.

## fix3 (kill)
- **15000/15000, 0 lost**, dupes 1000, settled 94.4 s. Two nacks: 59
  (15:56:24.0) then 113 (15:56:53.9). Runs 14828 -> 14887 -> 15000 in
  step with them; markDelete held 34:1702 until the last.
- Only one listener rollback logged; the cause of the second nack wasn't
  traced. Under the old 40 s stall timeout this run would have looked
  like 172 lost.

## fixctl (no kill)
- 15000/15000, 0 dupes, 0 nacks, settled 20.9 s.
