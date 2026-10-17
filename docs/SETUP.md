# Setup and deployment

## 1. Local sandbox

Use Node.js **24+** and npm. Built-in SQLite avoids a native addon install. The package lock pins the exact dependencies used in the included evidence.

```bash
npm ci
npm run verify
```

No GitHub token, LLM key, n8n account or cloud account is needed for this demonstration. The issue simulator is deliberately non-idempotent. The independent tracker is a local SQLite-backed service. Both are real MCP processes.

## 2. Connect an MCP client or NitroStudio

```bash
npm run build
```

In NitroStudio choose Add Server / Nitro Project and select the extracted project folder. If its project runner does not use this repository's scripts, configure a STDIO server explicitly: command `node`, argument `/absolute/path/to/retryproof/dist/index.js`, working directory the repository root. Build first. The project has no Next.js widgets; its interface is the four tools and their JSON evidence.

For a standard client, copy `examples/mcp-client.json`, replace every absolute path, and place it in that client's MCP configuration. Set `RP_DATA_DIR` to an absolute private path so a client's working directory does not relocate the ledger.

Ask the agent:

> Discover RetryProof's connected services. Start a task with request_id `my-first-handoff`, title `Fix parser crash`, body `Reproduction: empty config`. Report the actual workflow status. If paused, inspect the receipt; do not invent a new request ID.

NitroStudio UI behavior has not been exercised here. STDIO tool execution and client interoperability are tested directly with the official SDK.

## 3. HTTP for n8n or a remote client

Copy `.env.example` to `.env`, configure the values below, then build and start. Do not commit `.env`.

```dotenv
RP_TRANSPORT=http
RP_HOST=127.0.0.1
RP_PORT=3000
RP_AUTH_TOKEN=replace-with-a-random-key-at-least-32-characters
RP_DATA_DIR=/absolute/private/path/retryproof-data
```

The MCP endpoint is `http://127.0.0.1:3000/mcp`; the framework health endpoint is `/mcp/health`. Clients must send the configured bearer credential for tool calls. Configure it in the client's secret/credential manager, not the request's task body.

For non-loopback hosting, set `RP_HOST=0.0.0.0`; startup requires a token of at least 32 characters. Terminate TLS at the hosting layer, restrict access, and preserve the data volume. This token maps to one server-configured workspace. There is no multi-tenant account system.

The included integration test starts the HTTP server, connects an unauthorized client and a bearer-authenticated client, rejects the former's tool call, and completes a handoff with the latter.

## 4. Optional real GitHub issue provider

Create a dedicated test repository and a fine-grained personal access token with access to that repository and Issues read/write permissions. Enable issues in the repository. This adapter uses a user token and checks `/user`; GitHub App installation tokens are not supported by this prototype.

```dotenv
RP_MODE=github
RP_GITHUB_OWNER=YOUR_ACCOUNT
RP_GITHUB_REPO=YOUR_TEST_REPOSITORY
RP_GITHUB_TOKEN=YOUR_PRIVATE_TOKEN
RP_MARKER_SECRET=YOUR_STABLE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

Use a fresh `RP_DATA_DIR` for an intentionally separate test installation. Keep the secret and directory stable for recovery. Do not erase a running installation's state to force a retry.

In this mode the issue MCP service calls the real GitHub REST API; the tracking service remains the independent local board. The gateway never calls GitHub directly. Creation appends an exact signed operation marker to the issue body. A human can edit visible text, but removing the marker can prevent recovery. The provider scans up to 1,000 issue/PR records and pauses if the complete verification scan exceeds this bound.

Live account behavior was not tested in the supplied evidence. To verify it yourself, start a new workflow, check the actual issue URL, compare the tracker source ID, restart the gateway with the same data, and replay the same request. Do not present the simulated baseline as a real GitHub outage.

## 5. Container

```bash
docker build -t retryproof .
docker run --rm -p 3000:3000 -v retryproof-data:/app/data \
  -e RP_AUTH_TOKEN=YOUR_RANDOM_KEY_AT_LEAST_32_CHARACTERS retryproof
```

The container defaults to the sandbox, exposes authenticated HTTP, and uses a named persistent volume. It is a single-node deployment. The Dockerfile is supplied for convenience; no Docker build was run in this workspace.

## 6. NitroCloud checklist

The event guide calls for NitroCloud deployment [S00](SOURCES.md#s00). This archive does not contain a deployed URL or pretend a deployment has been completed.

Before uploading or connecting the repository, confirm that the chosen runtime supports Node 24+, STDIO child processes and durable local storage. Set `RP_TRANSPORT=http`, `RP_HOST=0.0.0.0`, a private `RP_AUTH_TOKEN`, and a genuinely persistent `RP_DATA_DIR`. Use `npm ci && npm run build` for build and `npm start` to run. `PORT` takes precedence over `RP_PORT` for platform-assigned ports.

Test `/mcp/health`, authenticated discovery, a complete handoff and restart recovery against the deployed URL. If the host has ephemeral disk or independent replicas, the included SQLite design does not meet the persistence requirement. Add a transactional shared store or select a suitable persistent single-node host before claiming restart reliability there.

Exclude `node_modules`, data files, tokens and logs from an upload. The event's LinkedIn post, demo video and final submission remain separate tasks.

## Configuration reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `RP_MODE` | `sandbox` | Issue provider mode: `sandbox` or `github`. |
| `RP_DATA_DIR` | `./data` | Durable private directory shared by gateway and local providers. |
| `RP_WORKSPACE` | `local-demo` | Server-controlled ledger namespace. |
| `RP_MARKER_SECRET` | Sandbox-only constant | Stable HMAC secret; required, at least 32 characters, for GitHub. |
| `RP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `RP_HOST` | `127.0.0.1` | HTTP bind address. |
| `PORT` / `RP_PORT` | `3000` | HTTP port; platform `PORT` wins. |
| `RP_AUTH_TOKEN` | Empty | Bearer credential; required for non-loopback HTTP. |
| `RP_TIMEOUT_MS` | `10000` | Downstream tool timeout, 100-120000 milliseconds. |
| `RP_GITHUB_OWNER`, `RP_GITHUB_REPO` | Empty | Explicit GitHub destination. |
| `RP_GITHUB_TOKEN` | Empty | Private user token for the GitHub adapter. |

The source selects the installed framework's tested legacy MCP path. `NITRO_MCP_PROTOCOL_VERSION` can override it upstream; this repository's evidence does not cover other protocol-era settings.
