import 'reflect-metadata';
import { McpApplicationFactory, McpApp, Module, ToolDecorator as Tool, z } from '@nitrostack/core';
import { LabProvider } from './lab.js';
import { GithubProvider } from './github.js';

const role = process.env.RP_PROVIDER_ROLE;
if (role !== 'issue' && role !== 'tracking') throw new Error('Explicit provider role required');
const live = process.env.RP_PROVIDER_MODE === 'github';
if (live && role !== 'issue') throw new Error('GitHub is supported only for issue operations');
const lab = !live ? new LabProvider(process.env.RP_PROVIDER_DB ?? '', process.env.RP_PROVIDER_TARGET ?? '') : undefined;
const github = live ? new GithubProvider(process.env.RP_GITHUB_TOKEN ?? '', process.env.RP_GITHUB_OWNER ?? '', process.env.RP_GITHUB_REPO ?? '') : undefined;
const provider = github ?? lab!;
const marker = z.string().regex(/^rp_[a-f0-9]{64}$/);
const createInput = z.object({ marker, title: z.string().min(1).max(200),
  body: z.string().max(10000), sourceId: z.string().max(200) }).strict();

class DomainTools {
  @Tool({ name: `${role}_create`, description: `Create a ${role} record in the configured destination. Non-idempotent; do not retry an ambiguous result.`,
    inputSchema: createInput, annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: live } })
  async create(input: z.infer<typeof createInput>) {
    const parsed = createInput.parse(input);
    return provider.create(parsed.marker, { title: parsed.title, body: parsed.body, sourceId: parsed.sourceId });
  }
  @Tool({ name: `${role}_find`, description: `Read ${role} records by exact operation marker. Missing results do not authorize a retry.`,
    inputSchema: z.object({ marker }).strict(), annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: live } })
  async find(input: { marker: string }) {
    const parsed = z.object({ marker }).strict().parse(input);
    if (lab?.fault() === 'malformed') return { outcome: 'found', effect: { id: null } };
    return provider.find(parsed.marker);
  }
}
class LabTools {
  @Tool({ name: 'lab_set_fault', description: 'Sandbox only: inject a deterministic fault for evaluation.',
    inputSchema: z.object({ fault: z.enum(['none', 'lost_response', 'unavailable', 'hidden_read', 'duplicate', 'wrong_target', 'malformed']) }).strict() })
  async setFault(input: { fault: Parameters<LabProvider['fault']>[0] }) {
    const parsed = z.object({ fault: z.enum(['none', 'lost_response', 'unavailable', 'hidden_read', 'duplicate', 'wrong_target', 'malformed']) }).strict().parse(input);
    return { fault: lab!.fault(parsed.fault) };
  }
  @Tool({ name: 'lab_list_records', description: 'Sandbox only: read the authoritative effect ledger.', inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true } })
  async list(input: Record<string, never>) { z.object({}).strict().parse(input); return { records: lab!.list() }; }
  @Tool({ name: 'lab_edit_record', description: 'Sandbox only: simulate a human edit.',
    inputSchema: z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(200) }).strict() })
  async edit(input: { id: string; title: string }) {
    const parsed = z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(200) }).strict().parse(input);
    lab!.edit(parsed.id, parsed.title); return { edited: true };
  }
}
@McpApp({ module: ProviderModule, server: { name: `retryproof-${role}-${live ? 'github' : 'sandbox'}`, version: '0.1.0', protocolVersion: 'legacy' }, logging: { level: 'error' } })
@Module({ name: `retryproof-${role}`, controllers: live ? [DomainTools] : [DomainTools, LabTools] })
class ProviderModule {}
const app = await McpApplicationFactory.create(ProviderModule);
await app.start({ transport: 'stdio' });
process.stdin.on('end', () => { lab?.close(); process.exit(0); });
