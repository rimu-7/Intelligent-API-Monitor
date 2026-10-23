import { isRole, type Role } from '@apimon/shared';
import type { Redis } from 'ioredis';
import { randomToken, sha256Hex } from '../../lib/crypto';

export const TICKET_TTL_SECONDS = 60;
const keyOf = (ticket: string) => `sse:ticket:${sha256Hex(ticket)}`;

export interface TicketOwner {
  userId: string;
  role: Role;
}

/**
 * EventSource cannot send headers, so the client trades its bearer token for a single-use,
 * 60-second ticket (§13.1). Only the ticket's hash is stored; GETDEL makes it single-use.
 */
export class StreamTickets {
  constructor(private readonly redis: Redis) {}

  async issue(owner: TicketOwner): Promise<{ ticket: string; expires_in: number }> {
    const ticket = randomToken(32);
    await this.redis.set(keyOf(ticket), JSON.stringify(owner), 'EX', TICKET_TTL_SECONDS);
    return { ticket, expires_in: TICKET_TTL_SECONDS };
  }

  async consume(ticket: string): Promise<TicketOwner | undefined> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(ticket)) return undefined;
    const raw = await this.redis.getdel(keyOf(ticket));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as Partial<TicketOwner>;
      return typeof value.userId === 'string' && isRole(value.role)
        ? { userId: value.userId, role: value.role }
        : undefined;
    } catch {
      return undefined;
    }
  }
}
