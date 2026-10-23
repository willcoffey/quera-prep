# Lost Runs Report: postgres kill (2026-10-23)

## Setup
Clean slate. `results` sub `task-manager` is **Exclusive**. Audit subs on
`results` and `runs` captured every message. 10 gates, 5 x 3000 runs,
postgres killed t+3 s, started t+10 s, 40 s stall timeout. Reset between
runs. Wall time ~8 min.

## Loss per run
| run | recorded | lost | dupes | nacked |
|---|---|---|---|---|
| kill1 | 15000 | 0 (22 masked) | 978 | 22 |
| kill2 | 14910 | **90** | 0 | 90 |
| kill3 | 14920 | **80** | 1000 | 80 |
| control | 15000 | 0 | 0 | 0 |

Outbox, errors and DLQ were 0 every run.

## Did the missing runs reach `results`?
Yes, all of them. kill2's 90 (task 1) and kill3's 80 (task 4) were all
on `results`, each a contiguous block (ledger entries 1651-1740 and
1739-1818) published t+2.9-3.1 s: the batch in flight at the kill.
kill1 lost a 22-message batch too, but those runs were among 1000 the
outbox re-sent (its DELETE failed in the outage). The re-runs filled
the gap (978 dupes + 22 fresh = 1000).

## Timeline (kill2)
- 14:54:38.32 listener thread `ntainer#0-0-C-1`: recordRun batch insert
  I/O error (broken pipe), "Application exception overridden by
  rollback exception". The batch is nacked.
- markDelete holds at 21:1650 through the outage, with no
  individuallyDeletedMessages and 0 unacked. The next successful batch
  isn't logged (no ack or message-id logging). By t+14.5 s markDelete is
  21:4599, past the failed entries.
- 14:55:38.37 (exactly 60 s, the default nack delay): `NegativeAcksTracker:
  90 messages will be re-delivered`. Nothing arrived: final markDelete
  21:14999, msgOutCounter = msgIn, DB unchanged. kill3 is identical
  (80 nacked, redelivered 60 s later, never delivered).

## Verdict: **confirmed**
The runs were published but never inserted, so the loss isn't upstream.
The failed batch was nacked and the subscription is Exclusive. A later
cumulative ack moved markDelete past the failed entries well before the
60 s nack redelivery, so the redelivery was a no-op. The only gap is
that there is no per-ack log line. The cumulative ack is inferred from
the cursor jumping with no individually deleted ranges.

## Fix verification (Shared subscription)
| run | recorded | lost | nacked -> redelivered | settled |
|---|---|---|---|---|
| fix1 | 15000 | 0 | 37 | 64 s |
| fix2 | 15000 | 0 | 56 | 64 s |
| fix3 | 15000 | 0 | 59 + 113 | 94 s |
| control | 15000 | 0 | 0 | 21 s |

The failed batch now stays as a hole in the cursor (markDelete holds,
individuallyDeletedMessages covers everything after it, unacked = batch
size) until the 60 s nack redelivery inserts it. In fix1 the redelivered
run_ids never reappeared on `results` otherwise, so recovery wasn't
outbox re-sends masking it. **Fix resolves the loss.** Recovery takes
60 s+ (nack delay); a 40 s stall timeout would misreport it as loss.
