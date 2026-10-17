# Minimal Web Dashboard

RetryProof includes a lightweight, minimal web interface built with plain HTML, minimal CSS, and vanilla JavaScript. It provides a visual inspection tool for the recovery engine, downstream MCP providers, and fault simulation.

---

## Purpose

The dashboard allows developers and evaluators to interactively observe the core guarantee of RetryProof:
* Dispatch an intent with a stable `request_id`.
* Simulate real-world failure modes (such as lost responses or hidden reads).
* Observe that ambiguous outcomes remain `paused` instead of creating duplicate external writes.
* Trigger read-based reconciliation to safely complete interrupted multi-service handoffs.

---

## Design Principles

* **Zero External Frontend Dependencies**: Built entirely with standard HTML5 and minimal CSS without frameworks (no React, Tailwind, or bundling steps).
* **Strict Minimal Styling**: Clean, high-contrast monochrome design focused purely on functional utility: Input, Processing, Output, and Documentation.
* **Dual Operation Modes**:
  1. **Connected Mode**: Interacts directly with the live TypeScript runtime, SQLite ledger, and local MCP provider instances via a lightweight native Node HTTP server.
  2. **Standalone Simulation Mode**: Can be opened directly as a local file (`file://`) in any web browser with client-side sandbox execution.

---

## Sections

### 1. Input
* **Request ID**: Stable identifier for a logical task. Reusing an existing ID triggers reconciliation rather than a duplicate operation.
* **Title & Description**: Task payload passed to downstream issue and tracking systems.
* **Simulate Fault**: Sandbox fault injection selector:
  * `none`: Normal execution.
  * `lost_response`: Withholds the MCP response after committing an external write.
  * `hidden_read`: Simulates read replication lag or temporarily hidden records.
  * `unavailable`: Simulates a temporary 503 service outage.
* **Actions**:
  * **Start Workflow**: Dispatches the task through `rp_start_workflow`.
  * **Resume / Recover**: Reconciles uncertain operations through `rp_resume_workflow`.
  * **Get Receipt**: Fetches the durable SQLite audit ledger and chronological events.
  * **Refresh Records**: Queries authoritative records from both downstream stores.
  * **New ID**: Generates a fresh random task ID.

### 2. Processing
* **Status Banner**: Displays current lifecycle state (`IDLE`, `IN_FLIGHT`, `PAUSED`, `COMPLETED`).
* **Pipeline Progress**: Visual 4-step pipeline:
  1. *Intent Logging* (Persisted to SQLite before dispatch)
  2. *Issue Service* (Dispatched to issue provider)
  3. *Read Verification* (Read-back verification of the marker)
  4. *Tracking Board* (Linked downstream record creation)
* **Execution Events**: Real-time chronological log of actions, state transitions, and recovery decisions.

### 3. Output
* **Authoritative Issue Records**: Live table of records created in the issue provider.
* **Authoritative Tracking Records**: Live table of records created on the tracking board with cross-system link IDs.
* **Verified Ledger Receipt**: Raw JSON viewer showing the verified receipt, markers, and cryptographic fingerprints.

### 4. Docs
* Embedded quick reference explaining duplicate prevention, the at-most-one dispatch guarantee, and MCP tool signatures.

---

## Server Endpoints (`scripts/server.mjs`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves the dashboard HTML, CSS, and JS assets from `ui/`. |
| `POST` | `/api/start` | Dispatches a new task (`request_id`, `title`, `body`). |
| `POST` | `/api/resume` | Reconciles an in-flight or paused task by reading evidence. |
| `GET` | `/api/receipt?request_id=...` | Retrieves the stored audit ledger and verification receipt. |
| `GET` | `/api/records` | Lists records from both issue and tracking providers. |
| `POST` | `/api/fault` | Injects deterministic sandbox fault modes (`lost_response`, `hidden_read`, etc.). |

---

## Running the UI

Start the dashboard server:

```bash
npm run ui
```

Then open your browser at:
[http://localhost:3000](http://localhost:3000)
