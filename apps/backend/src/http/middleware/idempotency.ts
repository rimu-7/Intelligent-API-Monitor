import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import { sha256Hex } from '../../lib/crypto';
import { ConflictError, UnprocessableError, ValidationError } from '../../lib/errors';
import { principalLabel } from '../principal';

const TTL_SECONDS = 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Marker =
  | { state: 'processing'; bodyHash: string }
  | { state: 'completed'; bodyHash: string; status: number; body: unknown };

/**
 * Optional `Idempotency-Key` (UUID) for ingestion routes (§8.3). Key
 * `idem:<route>:<principal>:<key>`, 24 h:
 * - first request: SET NX a processing marker, run, store status + body (5xx → marker deleted)
 * - same key, different body → 422 IDEMPOTENCY_KEY_REUSED
 * - same key, still processing → 409 IDEMPOTENCY_IN_PROGRESS
 * - same key, completed → replay with `Idempotent-Replayed: true`
 */
export const idempotency =
  (redis: Redis, logger: Logger, routeKey: string): RequestHandler =>
  async (req, res, next) => {
    const key = req.header('idempotency-key');
    if (key === undefined) return next();
    if (!UUID.test(key)) {
      throw new ValidationError('Idempotency-Key must be a UUID', [
        { path: 'Idempotency-Key', message: 'must be a UUID' },
      ]);
    }

    const redisKey = `idem:${routeKey}:${principalLabel(req.principal)}:${key.toLowerCase()}`;
    const bodyHash = sha256Hex(JSON.stringify(req.body ?? null));
    const processing: Marker = { state: 'processing', bodyHash };

    const acquired = await redis.set(redisKey, JSON.stringify(processing), 'EX', TTL_SECONDS, 'NX');
    if (acquired !== 'OK') {
      const raw = await redis.get(redisKey);
      const existing = raw ? (JSON.parse(raw) as Marker) : processing;
      if (existing.bodyHash !== bodyHash) {
        throw new UnprocessableError(
          'Idempotency-Key was already used with a different body',
          'IDEMPOTENCY_KEY_REUSED',
        );
      }
      if (existing.state === 'processing') {
        throw new ConflictError(
          'A request with this Idempotency-Key is still being processed',
          'IDEMPOTENCY_IN_PROGRESS',
        );
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.status).json(existing.body);
      return;
    }

    let captured: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      captured = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const store =
        res.statusCode >= 500
          ? redis.del(redisKey) // let the client retry
          : redis.set(
              redisKey,
              JSON.stringify({
                state: 'completed',
                bodyHash,
                status: res.statusCode,
                body: captured,
              } satisfies Marker),
              'EX',
              TTL_SECONDS,
            );
      store.catch((err: unknown) => logger.error({ err }, 'idempotency marker update failed'));
    });
    // Connection dropped before a response was sent: release the key so a retry can run.
    res.on('close', () => {
      if (!res.writableFinished) {
        redis
          .del(redisKey)
          .catch((err: unknown) => logger.error({ err }, 'idempotency marker release failed'));
      }
    });

    next();
  };
