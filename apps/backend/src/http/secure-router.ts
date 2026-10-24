import { Router, type Request, type RequestHandler, type Response } from 'express';
import { authorizeAccess, type Access } from './middleware/authorize';
import { validate, type RouteSchemas, type ValidatedInput } from './middleware/validate';

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

export interface RegisteredRoute {
  method: HttpMethod;
  /** Express path, e.g. `/api/v1/alerts/:id`. */
  path: string;
  /** OpenAPI path, e.g. `/api/v1/alerts/{id}`. */
  openapiPath: string;
  access: Access;
}

/** Every route the app serves. The contract tests compare it with docs/openapi.yaml (§15.6). */
export class RouteRegistry {
  readonly routes: RegisteredRoute[] = [];

  add(route: RegisteredRoute): void {
    const duplicate = this.routes.some((r) => r.method === route.method && r.path === route.path);
    if (duplicate) throw new Error(`Route registered twice: ${route.method.toUpperCase()} ${route.path}`);
    this.routes.push(route);
  }
}

export interface RouteConfig<S extends RouteSchemas> {
  method: HttpMethod;
  path: string;
  /** Required: a route without an access declaration does not compile. */
  access: Access;
  schemas?: S;
  /** Extra middleware run after authorization and before validation (rate limits, idempotency). */
  middleware?: RequestHandler[];
  handler: (req: Request, res: Response, input: ValidatedInput<S>) => Promise<void> | void;
}

/** Routes without schemas get `undefined` for body/query/params. */
interface NoSchemas {
  body?: undefined;
  query?: undefined;
  params?: undefined;
}

const toOpenapiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * The only way to declare a route (§11.1). Order per route:
 * authorize(access) → middleware → validate(schemas) → handler.
 */
export class SecureRouter {
  readonly router = Router();

  constructor(
    private readonly registry: RouteRegistry,
    /** Path this router is mounted at, used for the registry only. */
    private readonly mountPath = '',
  ) {}

  route<S extends RouteSchemas = NoSchemas>(config: RouteConfig<S>): void {
    const fullPath = `${this.mountPath}${config.path}`;
    this.registry.add({
      method: config.method,
      path: fullPath,
      openapiPath: toOpenapiPath(fullPath),
      access: config.access,
    });

    const handler: RequestHandler = async (req, res) => {
      await config.handler(req, res, res.locals.validated as ValidatedInput<S>);
    };

    this.router[config.method](
      config.path,
      authorizeAccess(config.access),
      ...(config.middleware ?? []),
      validate(config.schemas ?? {}),
      handler,
    );
  }
}
