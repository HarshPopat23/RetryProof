# Verification and reproducibility

## Commands

```bash
npm ci
npm run verify
npm run test:coverage
```

`verify` runs build, the full test suite, and the executed comparison demo. It writes `evidence/verification.json`, `evidence/test-results.tap`, and `evidence/demo-results.json`. An exit code other than zero means the package is not ready. `test:coverage` is optional and reports local process coverage; a percentage is not a proof of correctness or a production success rate.

## Test layers

| Layer | What is real | What is controlled |
| --- | --- | --- |
| Core tests | SQLite files, transactions, state versions, engine code. | In-memory domain ports and chosen failures. |
| GitHub adapter | Actual adapter code and Fetch-compatible HTTP response parsing. | HTTP responses; no real account or internet writes. |
| STDIO integration | NitroStack gateway, two provider processes, MCP initialization, discovery and calls. | Locally generated sandbox data and fault modes. |
| HTTP integration | NitroStack HTTP server, official Streamable HTTP client, bearer propagation and real tool calls. | Local port and sandbox records. |
| Comparison demo | Real MCP timeout, non-idempotent persisted effects, gateway recreation and read-back. | Seeded fault trigger and example issue contents. |

## Important adversarial cases

* Response delayed beyond the tool timeout after the effect is committed.
* Gateway terminated with SIGKILL while the response is still pending.
* Two gateway processes race on the same request and share one SQLite ledger.
* A cached/stale lookup hides an effect that really exists.
* Verification service unavailable or returning malformed data.
* Multiple candidate records, wrong target, wrong source or empty identity fields.
* Human edit between the write and recovery.
* Same key with changed content; same content with deliberately different keys.
* Changed marker secret or destination configuration.
* Unauthorized tool calls and attempted metadata-based workspace selection.
* Invalid IDs, oversized content and additional request fields.
* A late worker attempts to overwrite a newer receipt.
* GitHub lists PRs as issues, spans pages, reaches the scan bound, returns errors, or contains copied marker candidates.

## Compare the evidence, not just green output

Read `demo-results.json` and count actual authoritative sandbox records. The baseline has two records with the same marker after one timed-out create and one explicit retry. The protected task has one issue marker and one tracking record linked to its verified source ID. Confirm that the title in its recovered receipt contains the later human correction.

The assertions fail on incorrect record counts, premature completion or lost edits. Test source is included so a judge can inspect the oracle instead of trusting a screenshot. The simulator is intentionally non-idempotent: a domain-level unique constraint is not silently preventing duplicates for the gateway.

## Limits

These are controlled correctness tests, not user research, load tests, formal verification or model benchmarks. Runtime and dependency versions are pinned in the lockfile and captured by verification. No claim is made about arbitrary MCP server compatibility, real-account permissions, cloud volume durability or all possible distributed failures.

Timing-dependent tests use short local timeouts so the suite finishes quickly. Slow machines may require longer test timeouts; distinguish process-start performance from the actual safety invariant before changing the code.
