# Three-minute judging walkthrough

Prepare: Node 24+, `npm ci`, `npm run verify`. Open `src/core/engine.ts` and the generated `evidence/demo-results.json`. Keep a recording as backup; the guidebook prioritizes a working end-to-end demonstration [S00](SOURCES.md#s00).

## 0:00-0:25 - Show the problem

“An external tool can do the work while its caller sees a timeout. If an agent repeats that action, one task can create two records. We improve n8n's recovery of one issue handoff by putting verification at its MCP boundary.”

## 0:25-1:00 - Reproduce the unsafe baseline

Run `npm run demo`. Show the `baseline_blind_retry` entry. The provider committed the first record and withheld its real MCP response past the client timeout. An explicit blind retry created another record. Show the count of two. State clearly that this is a deliberately fault-injected sandbox.

## 1:00-1:45 - Show protected recovery

Show the protected run's `paused_receipt`: an intent is saved, a dispatch is claimed, and the outcome becomes unknown. Show the recovered receipt after a new gateway process starts. One external issue was reused, and the separate tracking record references that issue's ID. Point out the preserved maintainer correction.

## 1:45-2:15 - Prove uncertainty handling

Show `absence_is_not_non_execution`. The effect exists, but reads hide it. Five recovery calls still create no second issue and do not proceed to the tracker. “We keep the honest answer, paused, instead of guessing.”

## 2:15-2:40 - Make MCP centrality visible

Open the discovered service catalogs in the evidence or call `rp_discover_capabilities` from a client. Explain that the gateway is both an MCP server and a client of two separate MCP services. The engine cannot bypass the tool boundary with direct database writes.

## 2:40-3:00 - Engineering and boundary

Show the SIGKILL and cross-process concurrency tests in the TAP report. “We guarantee at most one gateway dispatch per stored operation with the original ledger intact. We do not claim exactly-once execution across arbitrary tools, and ambiguous cases can remain paused.”

End with the live authenticated URL only after you deploy and verify it. The delivered archive contains reproducible local code and evidence, not a fabricated hosted URL or video.
