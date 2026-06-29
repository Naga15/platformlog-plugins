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
import { generateText } from 'ai';
import { resolveModel } from './createModel';
import { CatalogContextRetriever } from './services/CatalogContextRetriever';
import { GenerateTextFn, QueryService } from './services/QueryService';
import {
  createModelProvider,
  ModelOption,
} from './services/ModelProvider';
import { createRouter } from './router/createRouter';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_CONTEXT_ENTITIES = 20;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/**
 * Backend plugin that answers catalog questions with an LLM grounded on
 * Backstage catalog entities.
 *
 * @public
 */
export const catalogAssistantPlugin = createBackendPlugin({
  pluginId: 'catalog-assistant',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
      },
      async init({ config, logger, httpRouter, httpAuth, auth, discovery }) {
        const sub = config.getOptionalConfig('catalogAssistant');
        const provider =
          sub?.getOptionalString('provider') ?? DEFAULT_PROVIDER;
        // Generic apiKey; falls back to the legacy anthropic-only field, then
        // to the provider SDK's own env var (e.g. ANTHROPIC_API_KEY).
        const apiKey =
          sub?.getOptionalString('apiKey') ??
          sub?.getOptionalString('anthropicApiKey') ??
          undefined;
        const modelId =
          sub?.getOptionalString('model') ??
          (provider === DEFAULT_PROVIDER ? DEFAULT_ANTHROPIC_MODEL : undefined);
        if (!modelId) {
          throw new Error(
            `catalog-assistant: a 'model' is required when provider is '${provider}'`,
          );
        }
        if (
          provider === 'anthropic' &&
          !apiKey &&
          !process.env.ANTHROPIC_API_KEY
        ) {
          throw new Error(
            'catalog-assistant: ANTHROPIC_API_KEY env var or ' +
              'catalogAssistant.apiKey config is required for the anthropic provider',
          );
        }

        const maxContextEntities =
          sub?.getOptionalNumber('maxContextEntities') ??
          DEFAULT_MAX_CONTEXT_ENTITIES;
        const maxOutputTokens =
          sub?.getOptionalNumber('maxOutputTokens') ??
          DEFAULT_MAX_OUTPUT_TOKENS;

        const baseURL = sub?.getOptionalString('baseURL');
        const awsRegion = sub?.getOptionalString('awsRegion');
        const awsAccessKeyId = sub?.getOptionalString('awsAccessKeyId');
        const awsSecretAccessKey = sub?.getOptionalString('awsSecretAccessKey');
        const awsSessionToken = sub?.getOptionalString('awsSessionToken');
        const baseModelOptions = {
          provider,
          apiKey,
          baseURL,
          awsRegion,
          awsAccessKeyId,
          awsSecretAccessKey,
          awsSessionToken,
        };

        // Resolve the default eagerly so a misconfiguration fails fast at boot.
        const model = await resolveModel({ ...baseModelOptions, modelId });
        logger.info(
          `catalog-assistant: using provider '${provider}' default model '${modelId}'`,
        );

        // Optional allowlist of selectable models for per-request override and
        // the UI dropdown. Enabled by default; drop entries to disable them.
        const enabledModels: ModelOption[] = (
          sub?.getOptionalConfigArray('models') ?? []
        )
          .filter(m => m.getOptionalBoolean('enabled') !== false)
          .map(m => {
            const id = m.getString('id');
            return { id, label: m.getOptionalString('label') ?? id };
          });
        if (enabledModels.length > 0) {
          logger.info(
            `catalog-assistant: ${enabledModels.length} selectable model(s): ` +
              enabledModels.map(m => m.id).join(', '),
          );
        }
        const modelProvider = createModelProvider({
          models: enabledModels,
          defaultModelId: modelId,
          baseOptions: baseModelOptions,
        });

        const catalog = new CatalogClient({ discoveryApi: discovery });
        const retriever = new CatalogContextRetriever(
          catalog,
          maxContextEntities,
        );
        const queryService = new QueryService(
          retriever,
          model,
          // GenerateTextFn is the narrow subset of the AI SDK's generateText
          // shape that the plugin actually uses; the real generateText accepts
          // many more options. The cast keeps the host-app wiring honest about
          // which fields we read while allowing the real SDK function in.
          generateText as unknown as GenerateTextFn,
          logger,
          maxOutputTokens,
          modelProvider,
        );

        httpRouter.use(createRouter({ queryService, httpAuth, auth, logger }));
      },
    });
  },
});
