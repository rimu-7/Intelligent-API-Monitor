import { readFileSync } from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import type { Express } from 'express';
import type { SecureRouter } from '../../http/secure-router';
import { findUp } from '../../lib/paths';

/** `./openapi.yaml` in the container image, `<repo>/docs/openapi.yaml` in host mode (§17.1). */
export const resolveOpenapiPath = (): string => {
  const candidates = [
    path.resolve(process.cwd(), 'openapi.yaml'),
    findUp('docs/openapi.yaml', import.meta.dirname),
  ];
  const found = candidates.find(
    (candidate) => candidate !== undefined && candidate.length > 0 && safeExists(candidate),
  );
  if (!found) throw new Error('openapi.yaml not found (expected ./openapi.yaml or <repo>/docs/openapi.yaml)');
  return found;
};

const safeExists = (file: string) => {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
};

export const loadOpenapiDocument = (): Record<string, unknown> =>
  parse(readFileSync(resolveOpenapiPath(), 'utf8')) as Record<string, unknown>;

/** helmet's default CSP blocks Swagger UI assets — /docs gets its own CSP (§16.3, §21.18). */
export const docsHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
});

export const registerDocsRoutes = (
  app: Express,
  router: SecureRouter,
  document: Record<string, unknown>,
): void => {
  const uiOptions = {
    customSiteTitle: 'API Monitor — API docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      deepLinking: true,
    },
  };

  // Swagger UI static assets + init script (public, read-only). Directory index is disabled.
  app.use('/docs', swaggerUi.serveFiles(document, uiOptions));
  const page = swaggerUi.setup(document, uiOptions);

  router.route({
    method: 'get',
    path: '/docs',
    access: { public: true },
    handler: (req, res) => {
      // The page loads its assets relatively (./swagger-ui.css), so it must be served at /docs/.
      if (!req.originalUrl.split('?')[0]?.endsWith('/')) {
        res.redirect(301, '/docs/');
        return;
      }
      page(req, res, () => undefined);
    },
  });

  router.route({
    method: 'get',
    path: '/docs/openapi.json',
    access: { public: true },
    handler: (_req, res) => {
      res.json(document);
    },
  });
};
