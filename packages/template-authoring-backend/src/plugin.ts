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
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { generateObject } from 'ai';
import { resolveModel } from './createModel';
import { ReferenceTemplateLoader } from './services/ReferenceTemplateLoader';
import {
  GenerateObjectFn,
  GeneratedTemplate,
  TemplateGenerationService,
} from './services/TemplateGenerationService';
import { TemplateValidator } from './services/TemplateValidator';
import { createRouter } from './router/createRouter';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_REFERENCE_TEMPLATES = 3;
const DEFAULT_OWNER = 'group:default/unowned';

/**
 * Backend plugin that generates Backstage scaffolder Template entities
 * from a natural-language description.
 *
 * @public
 */
export const templateAuthoringPlugin = createBackendPlugin({
  pluginId: 'template-authoring',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        discovery: coreServices.discovery,
      },
      async init({ config, logger, httpRouter, httpAuth, discovery }) {
        const sub = config.getOptionalConfig('templateAuthoring');
        const provider =
          sub?.getOptionalString('provider') ?? DEFAULT_PROVIDER;
        const apiKey =
          sub?.getOptionalString('apiKey') ??
          sub?.getOptionalString('anthropicApiKey') ??
          undefined;
        const modelId =
          sub?.getOptionalString('model') ??
          (provider === DEFAULT_PROVIDER ? DEFAULT_ANTHROPIC_MODEL : undefined);
        if (!modelId) {
          throw new Error(
            `template-authoring: a 'model' is required when provider is '${provider}'`,
          );
        }
        if (
          provider === 'anthropic' &&
          !apiKey &&
          !process.env.ANTHROPIC_API_KEY
        ) {
          throw new Error(
            'template-authoring: ANTHROPIC_API_KEY env var or ' +
              'templateAuthoring.apiKey config is required for the anthropic provider',
          );
        }

        const maxRefs =
          sub?.getOptionalNumber('maxReferenceTemplates') ??
          DEFAULT_MAX_REFERENCE_TEMPLATES;
        const defaultOwner =
          sub?.getOptionalString('defaultOwner') ?? DEFAULT_OWNER;

        const model = await resolveModel({ provider, modelId, apiKey });
        logger.info(
          `template-authoring: using provider '${provider}' model '${modelId}'`,
        );

        const catalog = new CatalogClient({ discoveryApi: discovery });
        const referenceLoader = new ReferenceTemplateLoader(catalog, maxRefs);
        const generationService = new TemplateGenerationService(
          referenceLoader,
          model,
          generateObject as unknown as GenerateObjectFn<GeneratedTemplate>,
          logger,
          defaultOwner,
        );
        const validator = new TemplateValidator();

        httpRouter.use(
          createRouter({
            generationService,
            validator,
            httpAuth,
            logger,
          }),
        );
      },
    });
  },
});
