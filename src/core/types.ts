export type State = 'prepared' | 'in_flight' | 'unknown' | 'verified' | 'blocked';
export type Kind = 'issue' | 'tracking';
export interface Effect {
  id: string;
  marker: string;
  target: string;
  title: string;
  body: string;
  sourceId: string;
  url: string;
}
export interface Evidence {
  effect: Effect;
  verifiedAt: string;
  method: 'read_after_write' | 'reconciled_read';
}
export type Lookup =
  | { outcome: 'found'; effect: Effect }
  | { outcome: 'not_found' }
  | { outcome: 'unavailable' | 'conflict'; reason: string };
export interface Payload {
  title: string;
  body: string;
  sourceId: string;
}
export interface Operation {
  key: string;
  runId: string;
  kind: Kind;
  target: string;
  fingerprint: string;
  marker: string;
  payload: Payload;
  state: State;
  evidence: Evidence | null;
  attempts: number;
  version: number;
  reason: string;
}
export interface Run {
  id: string;
  fingerprint: string;
  title: string;
  body: string;
  issueTarget: string;
  trackerTarget: string;
}
export interface DomainPort {
  // Optional, read-only transport/capability preflight. It must not create effects.
  ready?(): Promise<void>;
  create(operation: Operation): Promise<void>;
  find(operation: Operation): Promise<Lookup>;
}
export interface Event {
  seq: number;
  operationKey: string;
  state: State;
  reason: string;
  at: string;
}
export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
