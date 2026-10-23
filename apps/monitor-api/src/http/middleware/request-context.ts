import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

interface RequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();
const INCOMING_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Current request id, available anywhere below the HTTP handler (and passed into job data). */
export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;

/** Accept a well-formed incoming x-request-id, otherwise generate one; echo it back (§16.1). */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  storage.run({ requestId }, () => next());
};
