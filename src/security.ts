import { timingSafeEqual } from 'node:crypto';

// Constant-time comparison so response timing doesn't leak how much of a secret matched.
export function secretsMatch(received: string | null | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
