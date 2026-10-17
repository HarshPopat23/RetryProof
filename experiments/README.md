# Historical participant experiment run

This folder retains the participant-supplied run generated at **2026-10-17 08:06:54 UTC** (13:36:54 IST). Its original summary reports 10 PASS results. The raw JSON receipts have not been rewritten or supplemented with invented historical observations.

## What can be checked in these files

- Nine distinct completed tasks contain eighteen verified issue/tracking operations, each with `attempts: 1` and consistent source links.
- Experiment 2 contains paused and recovered receipts; issue recovery uses `reconciled_read`.
- Experiments 3 and 4 identify GitHub issues 7 and 8. Their event logs show temporary missing observations before reconciliation succeeded. These are participant-supplied receipts, not live reads performed by the subsequent review.
- Experiment 5 contains identical client/dashboard receipts; experiment 7 contains identical receipts before/after dashboard reconnect; experiment 9 contains identical receipts after agent start/recovery.
- Experiment 10 contains the approved adversarial body literally. This injection input was handled correctly in that run.

## Limits of the original exports

| Claim | Missing evidence / correct interpretation |
| --- | --- |
| No duplicate records after every replay | Complete before/after inventories were not exported; a ledger dispatch count alone is insufficient to prove the entire provider inventory. |
| Wrong-token authentication denial | Experiment 8 has generic errors, not the remote HTTP status. It does not distinguish authentication denial from other connection failures. |
| Backend crash/restart | Experiment 7 reconnects the dashboard client; it does not restart the server. Separate tests demonstrate a local gateway crash. |
| General prompt-injection protection | Only one input was submitted and the model followed the approved task. The backend rejection branch was not exercised by that result A. |
| NitroStudio UI operation | The runner uses the official MCP SDK client; no NitroStudio UI trace is present. |

The annotated [original summary](EXPERIMENT_RESULTS.md) preserves the reported statuses while correcting their interpretation. [New experiment instructions](../docs/EXPERIMENTS.md) describe stricter collection, direct HTTP status capture, independently labeled rejection fixtures and a real SIGKILL supplement. New outputs live under `evidence/experiment-runs/`; they do not replace these historical files.
