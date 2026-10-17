# RetryProof experiment run

Run: 20261017T083657263Z-39557487

6 PASS; 0 FAIL; 4 BLOCKED.

| # | Experiment | Status | Evidence / boundary |
| --- | --- | --- | --- |
| 1 | Sandbox normal execution and three completed replays | PASS | See exp-1.json and exp-1-inventories.json |
| 2 | Sandbox lost response and read-only reconciliation | PASS | See exp-2.json and exp-2-inventories.json |
| 3 | GitHub handoff and authoritative before/after inventory | BLOCKED | Live GitHub writes not requested; use --live. |
| 4 | GitHub changed-content conflict preserves original issue | BLOCKED | Live GitHub writes not requested; use --live. |
| 5 | SDK MCP client and dashboard share one handoff | PASS | See exp-5.json and exp-5-inventories.json |
| 6 | Hidden reads pause tracking through repeated client recovery | PASS | See exp-6.json and exp-6-inventories.json |
| 7 | Remote HTTP MCP dashboard reconnect (not backend restart) | PASS | See exp-7.json and exp-7-inventories.json |
| 8 | Remote server returns HTTP 401 for wrong bearer token | PASS | See exp-8.json and exp-8-inventories.json |
| 9 | API-powered agent selects one permitted MCP action | BLOCKED | Paid model calls not requested; use --live. |
| 10 | This injection input was handled correctly | BLOCKED | Paid model calls not requested; use --live. |

## Interpretation

- Local SDK client, not a NitroStudio UI run.
- Remote MCP uses a separate local dashboard HTTP bridge, not cloud deployment.
- Experiment 7 tests dashboard reconnect, not backend restart. Supplemental SIGKILL evidence is separate.
- Experiment 10 covers this input only; controlled rejection-path evidence is separate.
- GitHub repository inventories are sequential bounded observations, not atomic or permanent proofs of absence.

Supplemental checks: Local gateway SIGKILL recovery: PASS; Controlled agent rejection paths: PASS. Runner failure: false.

Inventories are saved at each stage before assertions. PASS requires successful assertions, not merely an HTTP response. No missing historical observations were reconstructed.
