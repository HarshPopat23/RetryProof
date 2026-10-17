# Validation history and current evidence

## Evidence review verification (2026-10-17)

The evidence-review changes were checked separately from the original delivery measurements below:

| Check | Current observed result | Evidence |
| --- | --- | --- |
| Strict build, automated suite and comparison demo | Passed; **75 tests passed, 0 failed, 0 skipped**. | `evidence/verification.json`, `evidence/test-results.tap`, `evidence/demo-results.json` |
| Fresh keyless experiment run | **6 PASS, 0 FAIL, 4 BLOCKED**. Live GitHub/model steps were not executed in this review. | [Run summary](../evidence/experiment-runs/20261017T083657263Z-39557487/EXPERIMENT_RESULTS.md) |
| Independent provider inventories | Before/after execution and replay snapshots saved for all six applicable experiments. | `exp-N-inventories.json` in the same run folder |
| Remote authentication | Actual HTTP **401**, known unauthorized body, successful valid-token discovery and unchanged provider inventories. | `exp-8.json` in the run folder |
| Actual gateway crash | SIGKILL in the commit-response window; a new gateway PID recovered saved in-flight intent with the same issue ID. | `supplement-gateway-crash.json` in the run folder |
| Controlled agent rejection | Four bad outputs rejected; **0 MCP dispatches**. These are fixtures, not paid inference. | `supplement-agent-rejection.json` in the run folder |

The committed run records its starting Git commit, dirty-tree flag and SHA-256 hashes of its runner and inventory helper. Its historical starting commit is not a claim that the generated evidence existed before this change. Model/GitHub credentials were unavailable to this review; the stricter live paths are implemented and documented for a future explicit run. No new coverage percentage, browser result or dependency advisory audit was measured for this change.

## Original delivery measurements

The original delivery checks below were measured on **Node.js v24.19.0, Linux**, during the final delivery checks. The raw evidence files are included; this page is a reading aid rather than a substitute for them.

| Check | Observed result | Raw evidence |
| --- | --- | --- |
| TypeScript compilation | Passed with strict settings. | `evidence/verification.json` |
| Full automated suite | **67 passed, 0 failed, 0 skipped.** | `evidence/test-results.tap` |
| Clean archive extraction | Fresh `npm ci --ignore-scripts`, build, all 67 tests and comparison demo passed. | `evidence/clean-extraction.json` |
| Chromium dashboard checks | **8 passed**, covering all five setup modes, recovery, credential clearing, reload behavior and mobile layout. Model/GitHub responses are controlled; MCP actions are real. | `evidence/browser-check.json` |
| Additional core two-process concurrency repetitions | **10 of 10 passed.** Each checks one effect per step after competing gateway calls. | `evidence/concurrency-stress.json` |
| Node executed-code line coverage | **95.80%.** | `evidence/coverage.txt` |
| Node executed-code branch coverage | **84.85%.** | `evidence/coverage.txt` |
| Node executed-code function coverage | **98.53%.** | `evidence/coverage.txt` |
| npm dependency advisory audit | **0 reported advisories** in the delivered dependency graph at check time. | `evidence/dependency-audit.json` |
| Unsafe baseline | Two authoritative sandbox records for one task after response loss and explicit blind retry. | `evidence/demo-results.json` |
| Protected recovery | One issue for the protected task, one linked tracking record, preserved human edit and no extra writes on completed replay. | `evidence/demo-results.json` |
| Uncertain verification | Five recovery calls while reads hide the record produce no repeated write and no premature tracker action. | `evidence/demo-results.json` |

Coverage describes the compiled JavaScript exercised by these controlled tests, including decorator/framework entry paths; it does not mean every real integration or failure has been tested. An advisory audit is not a security certification.

Source and lockfile hashes match between the working project and the clean extraction. The package also carries `MANIFEST.sha256`, listing hashes for every delivered file except the manifest itself.

## Boundaries that remain

The original automated adapter/browser checks use controlled GitHub/model responses. Separate participant-supplied historical receipts identify live GitHub and Groq interactions; their export limits are documented in [Historical review](../experiments/README.md). Fresh keyless runs do not repeat those live interactions. n8n UI execution, NitroStudio UI operation, Docker construction and cloud deployment are not represented as completed. Current experiment collection and reconnect/crash boundaries are described in the [Experiment guide](EXPERIMENTS.md).
