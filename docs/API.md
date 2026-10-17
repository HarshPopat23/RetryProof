# MCP tool contract

The optional connected dashboard adds local `/api/...` routes which invoke these MCP tools through an actual MCP client. Its setup, credential requirements and separate loopback listener are described in [UI setup](UI_SETUP.md). It does not add key fields to the public recovery tools or change the engine's recovery policy.

The public catalog contains four tools. They are registered through NitroStack decorators; input schemas are generated from Zod, and each handler independently parses input before performing work. Tool annotations are advisory metadata [S01](SOURCES.md#s01); the engine enforces the guarantees.

## Start

Tool: `rp_start_workflow`

```json
{
  "request_id": "parser-bug-001",
  "title": "Handle an empty configuration",
  "body": "Steps to reproduce: load a zero-byte config file."
}
```

`request_id`: 1-80 ASCII letters, digits, underscores or hyphens. Title: trimmed, 1-200 characters. Body: at most 10,000 characters. Unexpected input properties are rejected. The destination repository and board are operator configuration, never arguments.

## Resume and receipt

Tools: `rp_resume_workflow`, `rp_get_receipt`

```json
{ "request_id": "parser-bug-001" }
```

`resume` can perform the second step if that step has never been dispatched. It does not mean 'repeat every prior request'. `get_receipt` reads only persisted gateway state.

## Discover

Tool: `rp_discover_capabilities`; arguments: `{}`.

Returns the configured mode/targets and the real `tools/list` catalogs of the two downstream providers. Sandbox administration tools are excluded from this public report and are never forwarded as public gateway tools.

## Result handling

Successful tool calls return JSON serialized into MCP text content. The included clients accept validated structured content or one JSON text block. A domain result contains:

* `request_id`: logical task identity.
* `status`: `completed` only when both steps have verified receipts; otherwise `paused`.
* `operations`: identity, state, attempts, versions and any evidence.
* `events`: latest 200 state transitions in chronological order; the full history remains in SQLite.
* `event_count`, `events_truncated`: total stored events and whether this response shows a bounded window.
* `guarantee`: the implementation's bounded dispatch claim.

For real, complete examples, inspect `evidence/demo-results.json`. IDs and timestamps are generated during execution, not prewritten success fixtures.

A domain `paused` result is a successful MCP communication about an incomplete workflow. Do not announce task completion, generate a new request ID to bypass it, or independently call the upstream creation tool. Resume later under the same ID or investigate. Authentication, validation and identity-conflict errors are MCP tool errors.

## Authentication

If `RP_AUTH_TOKEN` is configured, every public tool requires `Authorization: Bearer <token>`. HTTP credentials are propagated by the framework and verified with a timing-safe comparison. For a STDIO client that supports request metadata, `_meta.authorization` can carry the same bearer value. The single-workspace prototype does not infer tenants from JWT payloads or arbitrary metadata.

The MCP initialize/catalog and framework health surface can remain readable without this token; tool execution and receipts are protected. Public multi-tenant deployments require a different identity design and perimeter review.

## Current framework compatibility note

In the installed NitroStack release, generated catalog schemas can advertise `additionalProperties: true` even for a strict Zod object. The public handlers still reject extra fields through explicit `.parse()`. Runtime rejection is tested. This metadata mismatch is documented rather than hidden or fixed by editing installed framework files.
