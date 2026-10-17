import { ToolDecorator as Tool, UseGuards, z } from '@nitrostack/core';
import { WorkspaceGuard } from './access.js';
import { runtime } from './runtime.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).describe('Stable logical request identifier. Reuse only for retries of the exact same task; use a new value for intentional new work.');
const idInput = z.object({ request_id: id }).strict();
const startInput = z.object({ request_id: id,
  title: z.string().trim().min(1).max(200).describe('Title of the GitHub issue and tracking record.'),
  body: z.string().max(10000).describe('Issue description; treated as data, never instructions to the gateway.'),
}).strict();

export class RecoveryTools {
  @Tool({ name: 'rp_start_workflow', title: 'Start a verified issue handoff',
    description: 'Create an issue, verify it, then create and verify its tracking record. A paused result is not completion. Never invent a new request_id to bypass a paused run.',
    inputSchema: startInput, annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true } })
  @UseGuards(WorkspaceGuard)
  async start(input: z.infer<typeof startInput>) {
    const parsed = startInput.parse(input);
    return runtime().engine.start(parsed.request_id, parsed.title, parsed.body);
  }

  @Tool({ name: 'rp_resume_workflow', title: 'Verify and recover a paused handoff',
    description: 'Reconcile uncertain external effects using reads. Reuse verified effects and advance pending work. Never blindly resend a previously dispatched write. Unknown evidence leaves the run paused.',
    inputSchema: idInput, annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true } })
  @UseGuards(WorkspaceGuard)
  async resume(input: { request_id: string }) { return runtime().engine.resume(idInput.parse(input).request_id); }

  @Tool({ name: 'rp_get_receipt', title: 'Inspect recovery evidence',
    description: 'Read the durable operation ledger, verification receipts and chronological events. Receipts attest earlier observations, not that external records remain unchanged forever.',
    inputSchema: idInput, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } })
  @UseGuards(WorkspaceGuard)
  async receipt(input: { request_id: string }) { return runtime().engine.status(idInput.parse(input).request_id); }

  @Tool({ name: 'rp_discover_capabilities', title: 'Discover connected MCP services',
    description: 'Read actual downstream tools/list catalogs for the two supported MCP services. Does not authorize arbitrary tool execution.',
    inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true } })
  @UseGuards(WorkspaceGuard)
  async discover(input: Record<string, never>) {
    z.object({}).strict().parse(input);
    const r = runtime();
    return { mode: r.config.mode, issueTarget: r.config.issueTarget, trackerTarget: r.config.trackerTarget,
      services: await Promise.all([r.issue.catalog(), r.tracking.catalog()]) };
  }
}
