import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { ValidationError } from '../../lib/errors';

export interface RouteSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

type Output<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface ValidatedInput<S extends RouteSchemas> {
  body: Output<S['body']>;
  query: Output<S['query']>;
  params: Output<S['params']>;
}

const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/**
 * Validates body/query/params and stores the parsed values in `res.locals.validated`
 * (Express 5 `req.query` is read-only). Invalid path params → 400 INVALID_ID before any SQL.
 */
export const validate =
  (schemas: RouteSchemas): RequestHandler =>
  (req, res, next) => {
    const validated: Record<'body' | 'query' | 'params', unknown> = {
      body: undefined,
      query: undefined,
      params: undefined,
    };

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success)
        throw new ValidationError('Invalid path parameter', issuesOf(result.error), 'INVALID_ID');
      validated.params = result.data;
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) throw new ValidationError('Invalid query parameters', issuesOf(result.error));
      validated.query = result.data;
    }
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body ?? {});
      if (!result.success) throw new ValidationError('Request validation failed', issuesOf(result.error));
      validated.body = result.data;
    }

    res.locals.validated = validated;
    next();
  };
