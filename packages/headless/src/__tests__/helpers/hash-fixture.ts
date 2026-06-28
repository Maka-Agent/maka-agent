import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
