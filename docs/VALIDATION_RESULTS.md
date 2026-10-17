# Delivered validation results

These results were measured on **Node.js v24.19.0, Linux**, during the final delivery checks. The raw evidence files are included; this page is a reading aid rather than a substitute for them.

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

GitHub REST adapter behavior is covered with controlled responses, not real account writes. The connected dashboard was tested in Chromium. n8n import/UI execution, NitroStudio UI use, Docker image construction and NitroCloud deployment were not performed. The archive contains instructions for those steps, not a fabricated live URL or success claim.
