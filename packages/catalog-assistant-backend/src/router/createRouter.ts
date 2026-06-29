/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AuthService,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import express, { NextFunction, Request, Response, Router } from 'express';
import { ChatMessage, QueryService } from '../services/QueryService';

/** Validates and normalizes the optional `history` field from a request body. */
function parseHistory(raw: unknown): ChatMessage[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new InputError('`history`, if provided, must be an array');
  }
  return raw.map((m, i) => {
    const turn = m as { role?: unknown; content?: unknown };
    if (
      (turn?.role !== 'user' && turn?.role !== 'assistant') ||
      typeof turn?.content !== 'string'
    ) {
      throw new InputError(
        `history[${i}] must be { role: 'user' | 'assistant', content: string }`,
      );
    }
    return { role: turn.role, content: turn.content };
  });
}

/**
 * Builds the express router exposing `POST /v1/query`.
 * @internal
 */
export function createRouter(options: {
  queryService: QueryService;
  httpAuth: HttpAuthService;
  auth: AuthService;
  logger: LoggerService;
}): Router {
  const { queryService, httpAuth, auth, logger } = options;
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  // Lists the models a caller may select (the enabled allowlist) plus the
  // default. Feeds the UI dropdown. Returns an empty list when no allowlist
  // is configured (single-model deployments).
  router.get(
    '/v1/models',
    asyncHandler(async (req, res) => {
      await httpAuth.credentials(req, { allow: ['user', 'service'] });
      res.json({
        models: queryService.listModels(),
        default: queryService.defaultModelId(),
      });
    }),
  );

  router.post(
    '/v1/query',
    asyncHandler(async (req, res) => {
      const body = req.body as
        | { question?: unknown; model?: unknown; history?: unknown }
        | undefined;
      if (!body || typeof body.question !== 'string') {
        throw new InputError('Request body must include a string `question`');
      }
      if (body.model !== undefined && typeof body.model !== 'string') {
        throw new InputError('`model`, if provided, must be a string');
      }
      const history = parseHistory(body.history);

      // Credential is read so a future retriever can use it to filter entities
      // the caller can actually see. Today's retriever ignores it.
      // Authenticate the caller to this endpoint.
      await httpAuth.credentials(req, { allow: ['user', 'service'] });
      // Read the catalog as this plugin's own service identity — works for any
      // caller (user, service, or external token); the retriever does no
      // per-user filtering today.
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog',
      });

      const start = Date.now();
      const result = await queryService.query(body.question, {
        credentials: { token },
        model: body.model,
        history,
      });
      logger.info(
        `catalog-assistant: answered question in ${Date.now() - start}ms`,
      );

      res.json(result);
    }),
  );

  return router;
}

// Express 4 does not surface async handler rejections to error middleware on
// its own; this wrapper bridges that gap. Once Backstage's httpRouter applies
// its own async middleware everywhere, this can be removed.
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
