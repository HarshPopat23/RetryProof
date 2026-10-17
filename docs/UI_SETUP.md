# Connected dashboard: install and replacement guide

This update replaces the uploaded browser-only simulation with a real local backend. Your black-and-white interface is retained and extended with a Connection setup section. It invokes the same tested NitroStack MCP gateway used by the command-line project.

## Run it

Use Node 24+ and open a terminal in the extracted `retryproof` folder:

```bash
npm ci
npm run dashboard
```

Open the printed **http://127.0.0.1:3400** URL. Keep the terminal running. Do not open `index.html` using `file://` or a standalone static-file server: the new interface needs its backend.

The first time, choose **Local sandbox** and press **Connect**, then **Start Workflow**. No keys are needed. The interface reads the two real persistent sandbox services, not JavaScript arrays.

## Five setup choices

| UI option | Enter | What the backend actually does |
| --- | --- | --- |
| Local sandbox | Workspace name; no keys. | Launches the real MCP gateway and reads its sandbox services. |
| Real GitHub issues | Owner, repository, user token, stable marker secret of at least 32 characters. | Checks account/repository access with reads, then configures the issue MCP provider. Start creates a real issue; the tracker remains local. |
| NitroStudio / another MCP client | Sandbox or GitHub provider; client bearer token of at least 32 characters. | Creates an authenticated local HTTP MCP bridge and gives you a client configuration preview. Enter your chosen token in the client. |
| Remote RetryProof server | MCP endpoint URL and its bearer token. | Connects the backend to the existing remote MCP endpoint and forwards the four supported tools. |
| My API-powered AI agent | Sandbox or GitHub provider; OpenAI/Groq/Gemini, model ID and API key. | Makes one provider function-calling request when Run agent is pressed, verifies the exact task arguments, then invokes the permitted MCP action. |

GitHub access checks do not establish that a particular token can successfully write an issue; check its Issues read/write permissions. The prototype accepts user tokens, not GitHub App installation tokens. No GitHub write or model call occurs just because Connect is pressed.

The model ID is supplied by you because availability and tool support depend on your provider/account. The agent uses the providers' documented OpenAI-compatible function-calling APIs; references are in [Sources](SOURCES.md). It is deliberately a bounded one-task agent, not an unrestricted chat assistant. A model that changes the task ID/content or returns extra calls is rejected before any MCP action.

## Remote origins

Loopback HTTP MCP endpoints are permitted for local testing. To connect an internet-hosted server, start the dashboard with its exact allowed HTTPS origin in `.env`:

```dotenv
RP_UI_REMOTE_ORIGINS=https://your-retryproof-host.example
```

Multiple origins can be separated by commas. Origins contain the scheme and host, with an optional port, but no path. The UI's endpoint still includes `/mcp`. Restart the dashboard after changing this environment setting. Credentials in URLs, query parameters, fragments, unapproved origins and redirects are rejected.

The dashboard itself binds only to `127.0.0.1`. Its administrative UI is intended for one local user. Use the separately deployed MCP server for public hosting; do not expose this credential-entry dashboard as a multi-user SaaS.

## Connecting NitroStudio

Choose the MCP client option, select a provider and enter a client bearer token you will retain. After Connect, the preview supplies a local MCP URL and JSON configuration. Use NitroStudio's remote/HTTP server configuration or another Streamable HTTP MCP client, and enter the same token in its credential settings. The exported JSON contains a token placeholder rather than the token itself.

Keep this dashboard process and its connected browser session alive. Disconnect or 45 minutes of session inactivity closes its client bridge. This connection is for clients on the same computer; a cloud client cannot reach your computer's `127.0.0.1` URL.

## Credential handling and recovery

* The frontend sends credentials to the same-origin local backend using a session cookie and CSRF header.
* Keys are cleared from input fields after a successful Connect. There is no browser `localStorage` or `sessionStorage` persistence.
* API keys, bearer tokens and marker secrets are not written to configuration files, returned in configuration previews or included in application logs. They remain in backend/child-process memory while connected.
* Disconnect releases the profile and closes its processes. A server restart also requires re-entry of credentials.
* Workspaces, intent and evidence remain on disk. Reconnect with the same workspace name, destination and original marker secret to recover existing tasks.
* Preserve the private data directory, including `dashboard.key`. Deleting/restoring stale state invalidates the same identity/persistence assumptions as the CLI gateway.
* The workflow's title/body and receipts are application data stored in SQLite; they are not encrypted by this prototype. The dashboard key derives profile locations and is not a general data-encryption key.

Selecting another usage mode or editing setup settings disables workflow actions until you press Connect. A failed new connection preserves the previous active profile. The visible error does not fabricate a successful replacement.

## Reading the output

In a local sandbox, tables show authoritative records read directly from the provider services. In GitHub/remote mode, they show verified observations in the loaded receipt, not a continuously refreshed list of every external issue. The interface labels this distinction.

Select Hidden Read, start a new task, and observe Paused. Change the fault to None and press Resume / Recover with the **same** request ID. The original issue is reused. A completed replay creates no new tracking record.

If the network fails, the interface reports it and keeps the task ID. It never falls back to simulated success. Inspect the receipt after reconnecting before deciding what to do next.

## Files to replace/add in an existing checkout

The simplest path is to use this full updated folder and keep your existing private `.env`/data outside the replacement. For a manual merge:

| File/group | Action |
| --- | --- |
| `web/index.html`, `web/style.css`, `web/app.js` | Replace the three UI files with these versions in the `web` folder. |
| `src/dashboard/` | Add the new backend, profile manager, MCP client/bridge and bounded agent. |
| `package.json`, `package-lock.json` | Replace for the new dashboard commands/version; no additional runtime package is required. |
| `scripts/verify.mjs`, `scripts/package.mjs`, `scripts/browser-check.mjs` | Replace/add updated verification and packaging scripts. |
| `test/dashboard.test.mjs` | Add API, MCP bridge, remote and credential-handling regressions. |
| `.env.example` | Merge the optional `RP_UI_PORT` and `RP_UI_REMOTE_ORIGINS` settings. |
| `docs/`, `README.md` | Updated usage, routes, testing boundaries and measured results. |

Do not replace your private credentials or delete an existing data directory. Existing MCP-only commands still work. There is no source change required in the recovery engine for this UI update.

## Tests

```bash
npm run verify
```

Optional Chromium UI checks need Playwright and its browser binary:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

`RP_BROWSER_EXECUTABLE` can point to an existing compatible Chromium binary for the browser check. Browser tests use controlled GitHub read/model responses, while sandbox actions and remote forwarding use real MCP processes. Those browser checks do not perform paid model calls or live GitHub writes. Participant-supplied integration receipts and the stricter optional live runner are documented separately in the [experiment guide](EXPERIMENTS.md).
