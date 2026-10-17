# Problem selection and prior-art analysis

## Decision

Choose **Developer Tools**, improve **n8n's multi-service issue handoff recovery**, and deliver a narrow MCP recovery server. The target user is a developer running agent-assisted workflows that create records in more than one system.

The event's largest judging factor is meaningful MCP use; it also asks for a clear before/after, functioning demonstration and feasible scope [S00](SOURCES.md#s00). RetryProof makes those visible through an execution boundary and fault-injected trace rather than a general chatbot.

## What the research establishes

MCP specifies tool discovery, calls and result formats [S01](SOURCES.md#s01). Cancellation is subject to completion races [S02](SOURCES.md#s02). A public reproduction reports duplicate effects when an application retries after a lost response [S03](SOURCES.md#s03). Stable idempotency identity is longstanding prior art [S04](SOURCES.md#s04).

n8n already exposes retry options and MCP functionality [S10](SOURCES.md#s10), [S12](SOURCES.md#s12). Therefore the project should not be described as adding MCP support to n8n, proving all n8n retries unsafe, or inventing idempotency.

## Competitor boundaries

| Existing work | Relevant overlap | Consequence for this project |
| --- | --- | --- |
| `mcp-idempotent` [S14](SOURCES.md#s14) | Stable retry identity and replayed results in an MCP proxy. | A cache around MCP calls is insufficient differentiation. |
| Aftercare [S15](SOURCES.md#s15) | Cross-service evidence, repairs and preserved edits. | Generic recovery and edit preservation are existing ideas. |
| Stripe [S04](SOURCES.md#s04) | Well-established request identity semantics. | Credit the underlying pattern rather than claiming a new protocol. |
| n8n [S10](SOURCES.md#s10) | Execution history and retry controls. | Integrate externally and demonstrate one failure case; do not duplicate its workflow editor. |

The focused contribution is a small, inspectable implementation of **durable pre-dispatch intent plus post-failure external verification**, with a deterministic unknown-outcome policy and executable crash-window tests. It is an engineering contribution suitable for a buildathon, not a claim of research novelty.

## Why this scope is a good fit

1. The baseline failure is easy to observe: one task produces two records.
2. MCP is in both public invocation and downstream execution paths.
3. The important decision is code-enforced: missing evidence cannot trigger another dispatch.
4. The demonstration needs no paid LLM service or production incident data.
5. A real GitHub adapter can be enabled later without changing the engine's recovery rules.

An ordinary API design could implement equivalent distributed-systems protections. MCP's role here is interoperability and a consistent agent-tool boundary, not an exclusive ability to solve retries.

## What would invalidate the project claim

If a retry under the same request identity creates another external record through this gateway with its original ledger intact, the dispatch guarantee is broken. If the second step runs without a verified source identity, handoff integrity is broken. If a new task is collapsed merely because its text matches an old one, intended-work semantics are broken. The tests assert these failure conditions directly.

There is no claim about production failure frequency, user demand volume, universal compatibility, a previously undiscovered vulnerability, or winning probability. Those would require additional evidence.
