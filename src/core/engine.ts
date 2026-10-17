import { fingerprint, markerFor } from './identity.js';
import { Store } from './store.js';
import { DomainError, type DomainPort, type Kind, type Operation, type Payload, type Run } from './types.js';

export interface EngineConfig { secret: string; issueTarget: string; trackerTarget: string }
export class Engine {
  private active = new Set<string>();
  constructor(readonly store: Store, readonly ports: Record<Kind, DomainPort>, readonly config: EngineConfig) {}
  async start(id: string, title: string, body: string) {
    const run = this.store.registerRun({ id, title, body, issueTarget: this.config.issueTarget,
      trackerTarget: this.config.trackerTarget, fingerprint: fingerprint({ title, body,
        issueTarget: this.config.issueTarget, trackerTarget: this.config.trackerTarget }) });
    return this.advance(run);
  }
  async resume(id: string) {
    const run = this.store.run(id);
    if (run.issueTarget !== this.config.issueTarget || run.trackerTarget !== this.config.trackerTarget)
      throw new DomainError('TARGET_CHANGED', 'Restore the original targets before recovery.');
    return this.advance(run);
  }
  status(id: string) {
    const run = this.store.run(id);
    const operations = this.store.operations(id);
    const eventCount = this.store.eventCount(id);
    return { request_id: run.id, status: operations.length === 2 && operations.every(op => op.state === 'verified') ? 'completed' : 'paused',
      operations, events: this.store.events(id), event_count: eventCount, events_truncated: eventCount > 200,
      guarantee: 'At most one gateway dispatch per persisted operation. Unknown outcomes are never automatically resent.' };
  }
  private async advance(run: Run) {
    const issue = await this.step(run, 'issue', run.issueTarget, { title: run.title, body: run.body, sourceId: '' });
    if (issue.state !== 'verified' || !issue.evidence) return this.status(run.id);
    await this.step(run, 'tracking', run.trackerTarget, {
      title: run.title, body: issue.evidence.effect.url, sourceId: issue.evidence.effect.id,
    });
    return this.status(run.id);
  }
  private async step(run: Run, kind: Kind, target: string, payload: Payload): Promise<Operation> {
    const key = `${run.id}:${kind}`;
    const hash = fingerprint({ ...payload, kind, target });
    let operation = this.store.prepare({ key, runId: run.id, kind, target, payload,
      fingerprint: hash, marker: markerFor(this.config.secret, this.store.workspace, key, hash),
      state: 'prepared', evidence: null, attempts: 0, version: 0, reason: 'Prepared' });
    if (operation.state === 'verified' || this.active.has(key)) return operation;
    if (operation.state !== 'prepared') return this.reconcile(operation);
    // A failed connection/catalog preflight has not dispatched a mutation.
    // Keep it prepared so a later attempt can safely establish the transport.
    try { await this.ports[kind].ready?.(); }
    catch { return operation; }
    const claim = this.store.claim(operation);
    operation = claim.operation;
    if (!claim.owned) return operation.state === 'verified' ? operation : this.reconcile(operation);
    this.active.add(key);
    try {
      try { await this.ports[kind].create(operation); }
      catch {
        // Deliberately return a paused result. Recovery is a later explicit call,
        // not an automatic resend, regardless of downstream error wording.
        return this.store.transition(operation, 'unknown', 'Write response unavailable or untrusted; verify before taking any further action');
      }
      return await this.reconcile(operation, 'read_after_write');
    } finally { this.active.delete(key); }
  }
  private async reconcile(operation: Operation, method: 'read_after_write' | 'reconciled_read' = 'reconciled_read'): Promise<Operation> {
    let lookup;
    try { lookup = await this.ports[operation.kind].find(operation); }
    catch { return this.store.transition(operation, 'unknown', 'Verification service unavailable; no write was repeated'); }
    if (lookup.outcome === 'found') {
      const effect = lookup.effect;
      // Titles/bodies can be changed legitimately after creation. Bind stable
      // identity, destination, and cross-system source instead of overwriting edits.
      if (effect.marker !== operation.marker || effect.target !== operation.target ||
          effect.sourceId !== operation.payload.sourceId || !effect.id || !effect.url) {
        return this.store.transition(operation, 'blocked', 'Returned record does not match the operation identity, target, or source');
      }
      return this.store.transition(operation, 'verified', 'External record read and identity verified', {
        effect, verifiedAt: new Date().toISOString(), method,
      });
    }
    if (lookup.outcome === 'conflict') return this.store.transition(operation, 'blocked', 'Multiple or conflicting records; manual investigation required');
    // A missing record can mean stale reads, deletion, truncated pagination, or an
    // in-flight write. It is never proof that a previously dispatched call did not run.
    return this.store.transition(operation, 'unknown', lookup.outcome === 'not_found'
      ? 'No matching record observed; absence is not proof of non-execution. No write repeated.'
      : 'Verification unavailable; no write repeated');
  }
}
