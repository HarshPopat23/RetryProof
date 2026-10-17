# Deploy RetryProof to NitroCloud

## What the failed-deployment log establishes

The supplied v4 log completes processing, TypeScript build, image creation and upload. It then reports deployment failure without including the container's runtime exception. The exact cloud crash message is therefore not present in that export.

The log explicitly says **user Dockerfiles are ignored** and selects **Standard Node.js**. Do not rely on this repository's Dockerfile, `.nvmrc`, or `.node-version` to force the managed runtime or its environment settings.

The code at that time advertised Node 20 support through a JSON-based SQLite imitation. Its constructor did not create a file before Store/LabProvider called `chmod`, making fresh Node 20 startup fail with `ENOENT`. It also ignored transaction locking and write failures. These are reproduced code defects, not a claim that the omitted cloud exception was observed.

## Fixes in this package

- Node 24 uses native `node:sqlite`. Node 20 uses pinned `better-sqlite3`: actual SQLite file creation, transactions, uniqueness constraints and interprocess locks. Existing SQLite files share the same format on both paths.
- The build prepares default `data/` for the managed image's non-root COPY step and checks the selected driver's transaction rollback before dependency pruning.
- Production/`PORT` startup defaults to HTTP on `0.0.0.0`. Explicit STDIO remains available to local MCP clients and subprocesses.
- No shared default bearer is invented. Startup errors identify configuration/storage problems without printing secrets. Readiness names the Node version, driver, endpoint and health path.
- **Run ordinary `npm ci`, not `npm ci --ignore-scripts`,** so the compatibility driver's native binary is installed.

## NitroCloud settings

Use the fixed ZIP or the commit containing this fix. Keep `package.json`, lockfile, `src/`, `scripts/` and `tsconfig.json` together.

| Setting | Value |
| --- | --- |
| Build | `npm ci && npm run build`; managed builds already perform equivalent steps |
| Start | `npm start` |
| Preferred runtime | Node 24; compatibility checked separately on Node 20.20.2 |
| `NODE_ENV` | `production` |
| `RP_TRANSPORT` | `http` |
| `RP_HOST` | `0.0.0.0` |
| `RP_AUTH_TOKEN` | Your private random token, at least 32 characters |
| `RP_MODE` | `sandbox` for the first deployment |
| `RP_WORKSPACE` | A stable name, for example `retryproof-demo` |
| `RP_DATA_DIR` | Writable persistent mount; `./data` is the prepared default, not proof of persistence |
| Port | Keep NitroCloud's assigned `PORT`; otherwise default is 3000 |
| Health path | `/mcp/health` |
| Instances | One instance with its intact SQLite state |

Generate a private bearer locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Enter it in NitroCloud's environment/secrets settings and use the same bearer in the MCP client's Authorization header. Do not include it in the ZIP or repository. The former source-published `sandbox-production-auth-token-min-32-chars-long` value is rejected for public HTTP; replace it if previously used.

For GitHub mode, additionally configure `RP_GITHUB_OWNER`, `RP_GITHUB_REPO`, `RP_GITHUB_TOKEN` and a stable `RP_MARKER_SECRET` (32+ characters), then set `RP_MODE=github`. Use a dedicated test repository. Tracking remains local.

## Verify after redeploying

1. In runtime **Deploy logs / container logs**, find `[RetryProof ready]`, its Node version and driver. Build logs alone do not establish readiness.
2. Open `https://YOUR-APP/mcp/health` and require success. The root URL shows framework MCP documentation, not the local credential-entry dashboard.
3. Connect NitroChat or a Streamable HTTP client to `https://YOUR-APP/mcp` with the bearer. Discover all four `rp_` tools and both downstream services.
4. Complete one task, save issue/tracking IDs and replay the same request ID. Both IDs must remain unchanged.
5. Restart the deployed server preserving the mount and configuration. Reload and recover the same task. Only then claim deployment-level restart recovery.

NitroCloud must permit the two Node STDIO provider subprocesses and preserve state across restart/redeploy. A Docker `VOLUME` declaration or writable container folder does not configure a persistent NitroCloud mount. Confirm the actual mount setting; separate replicas with independent disks are outside this version's guarantee.

## If it still fails

| Observation | Action |
| --- | --- |
| `CONFIG` / `RP_AUTH_TOKEN` | Configure a private 32+ character token, valid port, and required GitHub values if enabled. |
| `EACCES`, `EPERM`, `EROFS` | Choose a mount writable by the runtime's `node` user. |
| SQLite native binding missing | Check that install scripts ran; inspect the dependency binary-download/build error. |
| `SQLITE_NOTADB` / old JSON `.sqlite` file | Back it up and preserve it for separate recovery/migration. This package refuses to reinterpret it as empty state. Never erase deduplication history to force retries. |
| Image builds but no runtime exception is shown | Export **runtime/container Deploy logs**, including exit and health details; the supplied v4 export omits them. |

The ZIP contains no credentials or live SQLite data. This workspace has not redeployed your NitroCloud account.

## Driver references

- [Node SQLite documentation](https://nodejs.org/api/sqlite.html): the built-in module was introduced in Node 22.5.0; changing `engines.node` alone cannot make it exist on Node 20.
- [Pinned better-sqlite3 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.8.0): includes Node 20 Linux musl binaries. The local verification uses Linux glibc; availability of a binary is not an executed Alpine test.
