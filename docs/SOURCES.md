# Research sources and claim boundaries

Reviewed for this project on **2026-10-17**. Links are primary specifications, official documentation, or project authors' repositories. A repository's README is evidence of that project's stated implementation, not proof of its production reliability. No source is used to claim a universal defect rate, saved money, or hackathon win probability.

### S00

**User-supplied Buildathon Guidebook.pdf, Version 1**, sections 1, 2, 4-8 and 10. Used for MCP delivery, original-workflow scope, NitroStack/Studio/Cloud workflow, judging criteria and submission requirements. Not redistributed in this archive. Exact dates, portal URL and final event decisions must come from the organizer.

### S01

**MCP tools specification, 2025-11-25**: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

Supports tool discovery/calls, input schemas, result envelopes and advisory tool annotations. RetryProof explicitly selects the installed framework's legacy protocol path for the tested SDK clients; it does not claim complete conformance to every later MCP revision.

### S02

**MCP cancellation specification, 2025-11-25**: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation

Cancellation can race with completion. Do not interpret a client timeout or cancellation as proof that an external side effect was undone.

### S03

**MCP issue #3394, lost-response reproduction**: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3394

The report documents a committed effect, withheld response, explicit application retry and duplicate effect on its tested SDK path. It distinguishes application behavior from a protocol defect. RetryProof's own sandbox reproduction is separate evidence; this issue's reported counts are not presented as our benchmark results.

### S04

**Stripe idempotent requests**: https://docs.stripe.com/api/idempotent_requests

Prior art for stable request identity and returning a previous result on retry. This repository contains no Stripe integration or payment processing.

### S05

**Official MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk

Source of the client/transport APIs. The exact installed dependency is in `package-lock.json`; current main-branch examples may target a different SDK generation. This project imports the installed `@modelcontextprotocol/sdk` package API, which is compiled and exercised in tests.

### S06

**NitroStack quick start**: https://docs.nitrostack.ai/quick-start

Framework bootstrapping and decorator patterns. The installed package source/types were also inspected to verify APIs rather than assuming every web example matched the installed release.

### S07

**NitroStack tools guide**: https://docs.nitrostack.ai/sdk/typescript/tools

Tool schema, annotations and execution-context concepts. The implementation adds explicit runtime parsing because the tested installed call path did not enforce the advertised schema on its own.

### S08

**NitroStack Streamable HTTP guide**: https://docs.nitrostack.ai/guides/streamable-http

HTTP and STDIO transport options, `/mcp`, legacy SSE compatibility and Accept negotiation. HTTP bearer propagation is verified by this project's transport test, not inferred solely from the guide.

### S09

**GitHub issues REST API**: https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28

Issue creation/listing, pagination and the distinction between issues and PR records. The adapter explicitly sends the `2022-11-28` version header. It does not assume GitHub provides an idempotency key for issue creation.

### S10

**n8n execution retries**: https://docs.n8n.io/workflows/executions/all-executions/

Supports the original workflow choice: n8n provides failed-execution retry options. It does not prove every workflow blindly repeats completed actions. RetryProof addresses the ambiguous-outcome case, which depends on node/tool behavior and caller retry policy.

### S11

**Node SQLite API**: https://nodejs.org/api/sqlite.html

Built-in database API used by the implementation. Node 24+ is the selected runtime. SQLite transactions provide the local coordination mechanism, not cross-service atomicity.

### S12

**n8n MCP server documentation**: https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/

Confirms n8n's existing MCP workflow capabilities; this is not a proposal to build its first MCP connection.

### S13

**n8n MCP Client Tool documentation**: https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/

Documents use of external MCP tools by n8n agents and supported authentication configurations. The provided import template uses HTTP Request nodes to make the handshake/tool calls visible. It has not been run in an n8n UI in this workspace.

### S14

**mcp-idempotent**: https://github.com/krish-shahh/mcp-idempotent

Direct prior art for a retry-deduplicating MCP proxy. Basic MCP deduplication is not claimed as an original invention here.

### S15

**Aftercare**: https://github.com/Calebux/Aftercare

Direct prior art for evidence-based recovery across services and preservation of human edits. Its README at review time describes a lost-provider-response recording limit in its MCP gateway path. That is a point-in-time, path-specific statement; it does not prove an ecosystem-wide gap or that Aftercare lacks all recovery support.

## Evidence produced in this repository

* `evidence/test-results.tap`: executed test outcomes, including real MCP transport tests and controlled GitHub HTTP responses.
* `evidence/demo-results.json`: executed sandbox baseline/protected comparison and actual operation receipts.
* `evidence/verification.json`: commands, outcomes, runtime, and artifact hashes.
* `evidence/dependency-audit.json`: dependency advisory response captured during verification, if available.
* `evidence/browser-check.json`: Chromium checks of the connected UI, when run; remote/sandbox MCP actions are real, model/GitHub responses are controlled fixtures.

## Dashboard agent API references

* OpenAI function calling: https://platform.openai.com/docs/guides/function-calling
* Groq tool use: https://console.groq.com/docs/tool-use/overview
* Gemini OpenAI-compatible API: https://ai.google.dev/gemini-api/docs/openai

These primary references establish the request/tool-call interfaces used by the optional agent. Account/model availability is supplied by the user; no live-key provider success rate is inferred from the controlled adapter tests.

Sources motivate the design. These files substantiate the local implementation. Neither substitutes for a real account integration test or a cloud deployment test.
