# Bug review and final verification

## Connected UI update

The uploaded UI's browser-array simulation and automatic fallback were removed. The new `/api` routes forward to real MCP calls, and connection failures remain visible. The backend holds credentials per connected browser session, rejects cross-origin/CSRF requests, restricts remote origins and exports a real token-protected MCP bridge without returning its bearer token.

Review also corrected a request-lock race by acquiring the session's busy flag before awaiting body parsing, restored the actual connected usage mode after browser reload, explicitly disabled inherited gateway bearer auth in managed STDIO children, and made the table labels distinguish authoritative sandbox records from historical remote receipt evidence. Tests cover the API behavior and optional browser checks exercise the actual controls.

The review concentrated on dispatch identity, crash windows, concurrent workers, MCP parsing, source linkage, private credentials and the reproducibility of the deliverable. Tests assert authoritative effects rather than merely checking that functions returned success.

## Findings fixed in this implementation

| Finding | Risk | Fix | Regression evidence |
| --- | --- | --- | --- |
| Advertised framework schema did not itself enforce strict runtime input validation on the tested call path. | Invalid IDs, oversized text or unexpected fields could reach handlers. | Explicit strict Zod parsing at every public and provider handler. | Wire tests reject invalid IDs, empty titles, oversized bodies and injected destination properties before a write. |
| Replacing the transport `onclose` handler discarded SDK cleanup. | Pending requests/timers could remain alive after a provider closed. | Chain the existing SDK handler before clearing the connection cache; import Zod directly in the client utility to avoid framework module timer side effects in short-lived CLI/test processes. | Tests and the comparison CLI exit normally after closing their provider connections. |
| Treating an observed `in_flight` state as dispatch ownership would allow a competing caller to send. | Duplicate writes from concurrent workers. | A separate transactional claim returns an explicit `owned` decision. Only its owner calls create. | Two engines and two gateway OS processes share a ledger and still create one effect per step. |
| A late worker could replace a newer verified result. | Recovery evidence could be downgraded after another worker succeeded. | Version-check every transition and return the already-newer state. | Stale-worker regression and cross-process concurrency test. |
| Returning the complete growing event history could make repeated recovery receipts excessively large. | Long-lived uncertain tasks could exceed practical MCP payload limits. | Return the latest 200 events with total count/truncation metadata; retain the full SQLite history. | More than 220 recoveries keep the response bounded without deleting history or repeating a write. |
| The first HTTP test polled `/health`, but the framework exposes `/mcp/health`. | A running server was incorrectly reported as unavailable. | Correct the readiness path and test authenticated tool calls through the actual HTTP client. | HTTP transport regression test. |
| SQLite startup set its busy timeout after switching journal mode. | Simultaneously launched provider processes could fail initialization under a competing lock, leaving the handoff paused. | Configure the database connection timeout at open and set `busy_timeout` before WAL; perform read-only MCP connection/discovery before claiming a mutation. | A held-lock startup test, preflight failure regression, and repeated two-process race checks. |
| The scaffold CLI brought unused development-server/file-watcher dependencies with audit advisories. | Unnecessary vulnerable development dependency surface. | Remove CLI and tsx from the delivered dependency graph; keep the already-generated project and direct TypeScript build. | Final captured `npm audit` response reports the remaining graph. |

The dispatch-claim and version protections were identified during design/code review; they were not presented as demonstrated defects in a released third-party product. The schema, cleanup and readiness mismatches were observed during implementation checks. The upstream catalog's permissive `additionalProperties` metadata remains documented in the API guide; runtime enforcement is independent of it.

## Failure conditions verified

| Failure | Required result |
| --- | --- |
| External write committed, response delayed beyond timeout | Persist unknown; no blind repeat. |
| SIGKILL after commit but before timeout | Recover from `in_flight` intent with one matching external effect. |
| Crash before actual send but after dispatch claim | Pause if external evidence is absent; do not guess. |
| Read hides a committed record | Repeated recovery cannot create another copy. |
| Verification outage, malformed result or duplicate match | Pause/block; do not advance the tracker. |
| Wrong destination, marker, source ID, empty ID/URL | Do not issue a verified receipt. |
| Human changes external title | Preserve it without writing old text back. |
| Same task ID with changed content or targets | Reject before another write. |
| New task ID with identical visible text | Execute intentional new work. |
| Unauthenticated HTTP/STDIO tool call with a configured token | Reject. |

The seeded sequence test additionally exercises 480 mixed-fault calls across 40 intentional tasks, then checks convergence after faults clear and verifies one issue/tracking effect per task. It is a controlled state-sequence test, not a measurement of real user/model reliability.

## Final checks and evidence

The authoritative execution status is `evidence/verification.json`; raw tests are in `evidence/test-results.tap`. Source and lockfile hashes bind that report to its inputs. `npm run package` refuses to package changed source or a failed verification report and adds a per-file SHA-256 manifest to the ZIP.

The final delivery procedure includes a clean archive extraction, dependency installation, TypeScript compilation and rerun of the executable checks. Any clean-extraction outcome is also recorded in `evidence/clean-extraction.json` when that final check is performed.

## Remaining limits

* This is one supported workflow, not a transparent recovery engine for arbitrary MCP tools.
* At-most-one dispatch needs the original intact ledger. No retention pruning, stale snapshot restore, or independent database replicas are supported.
* Some harmless failures can leave a task paused indefinitely. No safe evidence means no automatic resend.
* Signed markers prove binding to stored intent, not the truth of a malicious provider. GitHub listing pagination is bounded and not a transactional snapshot.
* Stored receipts are historical observations. Deletion or edits after verification are not continuously monitored.
* The local board is an actual persistent MCP service, not a tested commercial tracker integration.
* No automatic rollback or compensating deletion is implemented.
* Single-workspace bearer access is not production multi-tenant OAuth/RBAC, and the framework's initialize/catalog/health surfaces are not all private.
* Local Node/SQLite tests cannot certify host filesystem durability or cloud volume persistence.
* GitHub live-account writes, n8n UI import/execution, NitroStudio UI use, Docker build and NitroCloud hosting were not performed here.

The package should be described as tested for these explicit cases, never as “bug-free” or universally exactly-once.

## Experiment evidence review (October 2026)

The historical experiment runner had six evidence weaknesses now addressed:

| Finding | Change | Check |
| --- | --- | --- |
| `.find()` selected one record without excluding duplicates. | Save complete provider inventories and assert exactly one added issue/tracker, marker multiplicity and unchanged replay IDs. | Inventory oracle regression deliberately supplies a duplicate. |
| A generic connection failure stood in for authentication evidence. | Direct HTTP initialization probe must receive 401/403; valid-token discovery must then succeed. | Real local authenticated bridge returns 401 with unchanged stores. |
| Any failed agent HTTP response was labeled safe rejection. | Accept only a known model argument/call rejection plus unchanged inventories; provider errors fail. | Separate controlled outputs exercise modified ID/title, multiple calls and wrong tool. |
| The supposed multiple-call regression supplied zero calls. | Supply two actual function calls. | Existing agent regression now reaches the multiple-call condition. |
| Fixed run IDs and published bearer values could contaminate later runs. | Isolated temporary services, unique run IDs, random runtime bearer values and explicit live opt-in. | Repeatable keyless runner and per-run provenance. |
| Dashboard reconnect was easy to confuse with backend crash recovery. | Label experiment 7 narrowly; save a separate real SIGKILL supplement. | New gateway PID, persisted in-flight state and unchanged committed issue ID. |

Historical JSON receipts remain unchanged. Their summary is annotated rather than backfilled. See [Experiment guide](EXPERIMENTS.md) for the observation boundaries and stricter rerun commands.
