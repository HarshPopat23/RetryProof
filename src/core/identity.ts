import { createHash, createHmac } from 'node:crypto';

// Inputs are validated flat records. Sorting makes property order irrelevant.
export function fingerprint(value: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(
    Object.keys(value).sort().map(key => [key, value[key]]),
  )).digest('hex');
}

export function markerFor(secret: string, workspace: string, key: string, hash: string): string {
  return `rp_${createHmac('sha256', secret).update(JSON.stringify([workspace, key, hash])).digest('hex')}`;
}
