# n8n integration

## Relationship to n8n

n8n remains the workflow/agent host. RetryProof is an external MCP server that owns one supported issue-to-tracker handoff. A workflow node that timed out does not by itself tell the caller whether its external effect occurred. n8n's existing execution retry controls are documented [S10](SOURCES.md#s10); their safety depends on what the node and its destination do.

The archive includes **`examples/n8n-workflow.json`**, an importable local demonstration design using standard Manual Trigger, Set, HTTP Request and Code nodes. It makes the initialize/notification/tool-call exchange visible. The JSON and MCP wire pattern are checked locally; actual import and execution inside an n8n installation have not been performed.

## Import and configure

1. Start RetryProof in HTTP mode, using the Setup guide.
2. Import `examples/n8n-workflow.json` into your n8n instance.
3. In **Task**, set the MCP endpoint reachable from n8n, a stable request ID, title and body. `127.0.0.1` works only when n8n and RetryProof share the host network. A Docker container's localhost is its own container.
4. The HTTP nodes are configured for a local loopback demo without a token. If `RP_AUTH_TOKEN` is set, add the same Header Auth credential to **all three HTTP nodes**: header `Authorization`, value `Bearer YOUR_TOKEN`. Store this in n8n credentials, not the Set node or exported JSON.
5. Execute the workflow. **Interpret result** returns the parsed status/receipt.
6. A `paused` result is not an exception and is not completion. Inspect it and use `rp_resume_workflow` with the same request ID. Never regenerate an ID just to make the workflow green.

The task node's `tool_name` defaults to `rp_start_workflow`. For a recovery call, change it to `rp_resume_workflow`; the template sends only `request_id` in that case. Completed repeats return the prior receipt and create no extra records.

## Agent-based alternative

n8n's MCP Client Tool node connects agents to external MCP tools [S13](SOURCES.md#s13). Configure that node with the RetryProof endpoint and bearer credential using the transport options available in your installed n8n release. Select the four `rp_` tools.

Suggested agent instruction:

> Use RetryProof for this issue handoff. Maintain one request_id across retries. Treat paused as incomplete. Obtain a receipt and resume under the same identity when appropriate. Never bypass the gateway by calling a downstream creation tool or inventing a replacement ID after uncertainty. Report what was verified and what remains unknown.

These instructions improve the client experience; they do not enforce the engine invariant. The gateway code refuses repeat dispatch even if an agent asks for one under an existing identity.

## Why not transparently retry every n8n node?

An arbitrary workflow can send mail, charge money, invoke a third-party MCP server or run custom code. Each effect needs its own identity and verification rules. This project supports a deliberate two-step handoff with explicit adapters. It does not intercept every existing n8n workflow, and it does not claim universal recovery.
