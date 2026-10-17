# Reproduce and inspect the experiment evidence

RetryProof's core claim is small: verify an uncertain external effect before progressing, and never blindly resend an operation already claimed in its durable ledger. Judge that claim from provider records and chronological receipts together.

The earlier participant run reported 10 PASS results. Its raw receipts are retained in [experiments](../experiments/README.md). Some before/after observations were not saved, so those files cannot establish every claim in their original summary. New runs use stricter assertions and capture observations when they actually happen; they do not backfill historical evidence.

## Choose a run

Use Node.js 24+ in the repository root:

```bash
npm ci
npm run verify
npm run experiments:local
```

The local run starts its own isolated dashboards on available loopback ports. It does not reuse the browser session at port 3400, its keys or its workspaces. It executes experiments **1, 2, 5, 6, 7 and 8** and reports **3, 4, 9 and 10 as BLOCKED** because live writes and model calls were not requested. Two supplemental checks exercise a real gateway crash and controlled agent rejection paths. No keys are required.

Each run writes a fresh folder under `evidence/experiment-runs/<timestamp-and-random-suffix>/`. Request IDs are unique per run. Provider databases are temporary and removed after the snapshots are saved. No fixed client/remote bearer tokens are committed. Use `RP_EXPERIMENT_OUT` to select another output parent.

For GitHub experiments and actual model inference, put these values in your private `.env` or environment:

| Variable | Meaning |
| --- | --- |
| `GITHUB_OWNER` | Owner of your test repository; no default owner is assumed. |
| `GITHUB_REPO` | Test repository name with Issues enabled. |
| `GITHUB_TOKEN` or `RP_GITHUB_TOKEN` | User token for that repository with Issues read/write. |
| `RP_MARKER_SECRET` or `MARKER_SECRET` | Private stable marker secret of at least 32 characters. |
| `GROQ_API_KEY` | Your Groq API key. |
| `GROQ_MODEL` | Explicit tool-capable model ID available to that account. |

Then run:

```bash
npm run experiments:live
```

This explicitly authorizes the runner to create two experiment issues and make model requests. Model usage may be billed. Missing configuration is BLOCKED, never PASS. A live run with blocked experiments exits nonzero. Do not commit `.env`, tokens, or unrelated private-repository contents. Inventories include issue titles/bodies: use a dedicated test repository and inspect outputs before publishing.

## What each experiment establishes

| # | Trigger | Required observations | Limit |
| --- | --- | --- | --- |
| 1 | Normal start, identical start replay, two recoveries | Exactly one added issue and tracker; identical receipts; unchanged ID inventories after replay. | Three controlled replays, not an unbounded reliability estimate. |
| 2 | Response withheld after issue commit | Paused receipt plus a persisted issue and no tracker; recovery keeps that issue and adds exactly one tracker. | Deterministic local fault, not a production outage. |
| 3 | Real GitHub issue creation and replay | Bounded, complete GitHub listings before/after plus local tracker-store snapshots; no added records after replay. | Sequential GitHub observations may lag; incomplete scans fail. |
| 4 | Existing request ID with changed title/body | Request rejected; original receipt preserved; repository/store ID inventories unchanged; original issue text retained. | Does not authorize edits or a different repository. |
| 5 | Start through official SDK client, recover through dashboard | Both clients return the same receipt; authoritative records do not increase after dashboard recovery. | Not a NitroStudio UI walkthrough. |
| 6 | Hide issue from verification reads, recover twice | One issue persists; no tracker added while hidden; one tracker only after visibility returns. | Fault applies to verification; provider inventory remains independently readable. |
| 7 | Dashboard disconnect and reconnect to remote endpoint | Same receipts and provider IDs before/after reconnect. | Server remains running. Not backend restart evidence. |
| 8 | Incorrect remote bearer, followed by valid-token control | Actual remote HTTP **401/403**, disconnected dashboard after failed connect, valid authenticated discovery, unchanged provider inventories. | Local HTTP bridge, not an arbitrary cloud server security audit. |
| 9 | API-powered agent start and recovery | Allowed tools reported; actual completed receipt; one issue/tracker; IDs unchanged after recovery. | One configured provider/model, not a model benchmark. |
| 10 | Instructions embedded inside approved issue body | A: exact approved arguments stored literally. B: a known argument/call rejection with unchanged inventories. | “This injection input was handled correctly.” Not general prompt-injection protection. |

## Read the saved files

| Artifact | How to review |
| --- | --- |
| `results.json` | PASS/FAIL/BLOCKED counts, boundaries, supplemental results, Node version and source provenance. |
| `EXPERIMENT_RESULTS.md` | Human-readable summary generated from actual result statuses. |
| `exp-N.json` | Tasks, receipts, replay receipts or typed HTTP observations. |
| `exp-N-inventories.json` | Full saved issue/tracker inventories for every observed stage, including before and after replay. |
| `supplement-gateway-crash.json` | Real SIGKILL termination, changed gateway PID, persisted in-flight intent and recovered provider IDs. |
| `supplement-agent-rejection.json` | Four controlled bad model responses rejected with zero MCP dispatches. |
| `runner-failure.json` | Setup/supplement failure, if any. Never interpret a partial run as all experiments passed. |

Inventories are saved **before assertions**, so failed comparisons remain inspectable. For local services the collector opens the provider's `effects` table read-only, not the gateway ledger. For GitHub it fetches repository issue pages independently with `state=all`, excludes pull requests, retains all marker matches and refuses to call a full ten-page scan complete. Tracker snapshots come from its separate provider store. Remote snapshots are possible because the test owns the separate local HTTP server; no inventory access to arbitrary remote hosts is implied.

Compare IDs, marker multiplicity and source links, not `.find()` on a matching title. The oracle rejects extra records, disappeared IDs, repeated dispatch attempts, wrong tracker sources and tracker dispatch before issue verification. GitHub listings are observations at collection time, not atomic snapshots or permanent proofs that no other writer could act.

## Authentication evidence: status versus error text

The wrong-token probe posts an actual MCP initialization request to the remote HTTP endpoint. It saves the response status and the local bridge's known unauthorized body without headers, supplied credentials or MCP session identifiers. An HTTP 400 from the dashboard, a timeout, or a generic connection message is insufficient.

The test then proves the same endpoint works with the correct credential by connecting and discovering both downstream services. Authoritative inventories must remain unchanged across both controls. The tested endpoint is the authenticated dashboard HTTP bridge. The standalone NitroStack HTTP server has tool-level authorization and may express denial as an MCP error rather than HTTP 401; do not label that different transport behavior a captured HTTP 401.

## Injection input versus rejection-path testing

Experiment 10's historical result A means the model obeyed its approved task and stored the adversarial body literally. That does not exercise the backend's rejection branch. The new supplement supplies four controlled model outputs: changed request ID, two tool calls, changed title and an unapproved tool. Each must be rejected before a gateway call.

A provider error, bad API key or timeout is not result B. The new live experiment requires a known model-argument/call rejection and unchanged independent inventories; other errors fail the experiment. Controlled fixtures are labeled separately from paid inference.

## Reconnect, restart and crash are different

| Evidence | What stopped | What the evidence demonstrates |
| --- | --- | --- |
| Experiment 7 | Dashboard's client connection | Same task is available when that client reconnects to the running server. |
| Existing comparison demo | Gateway closed and recreated | Recovery from saved state after graceful gateway recreation. |
| SIGKILL supplement and integration test | Gateway process killed after provider commit, before response timeout | A new gateway sees `in_flight` intent, reads the existing issue and completes tracking without another issue dispatch. |
| Not demonstrated | Complete host loss, database rollback, independent cloud replicas | No claim of recovery under those conditions. |

The supplement is a local STDIO gateway crash. It is not a restart of the complete dashboard process or a deployed remote service. Preserve the state directory and configuration in real use. RetryProof promises at most one gateway dispatch per persisted operation under its stated ledger assumptions, not universal exactly-once execution.

## A short judging walkthrough

1. Run the local command and open its generated summary. Show the six PASS/four BLOCKED distinction.
2. In experiment 2, compare before, after-timeout and after-recovery inventories. Show the same issue ID and `reconciled_read` evidence.
3. In experiment 6, show no tracking effect while verification is hidden, then its linked source ID after recovery.
4. In experiment 8, show the actual 401 response and successful valid-token discovery.
5. Show the SIGKILL supplement separately from experiment 7. End with the explicit scope and remaining live experiments.

For live GitHub/model claims, use a fresh `--live` run and its own files. Never imply the local-only run executed those integrations.
