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

import { InputError } from '@backstage/errors';
import { resolveModel, ResolveModelOptions } from '../createModel';

/**
 * A model offered to callers — `id` is the provider model id passed to the
 * SDK, `label` is the human-friendly name shown in the UI dropdown.
 *
 * @public
 */
export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Resolves model ids to AI SDK language models against an admin-configured
 * allowlist, and lists the models offered to callers (e.g. for a UI dropdown).
 * Resolution is lazy and cached so each allowed model is built at most once.
 *
 * @public
 */
export interface ModelProvider {
  /** Models offered to callers (the enabled allowlist). */
  list(): ModelOption[];
  /** The model id used when a request doesn't specify one. */
  defaultId(): string;
  /**
   * Resolve a model by id. Throws {@link @backstage/errors#InputError} if the
   * id is not in the allowlist (and not the default).
   */
  get(id: string): Promise<unknown>;
}

/**
 * Builds a {@link ModelProvider} over a set of allowed models that all share
 * the same provider/credentials base options, varying only the model id.
 *
 * The default model id is always resolvable even if it isn't in `models`, so a
 * request that omits a model never fails the allowlist check.
 *
 * @public
 */
export function createModelProvider(args: {
  /** Enabled models, in the order they should appear in a dropdown. */
  models: ModelOption[];
  /** Model id used when a request omits one. */
  defaultModelId: string;
  /** Shared resolve options (provider, credentials, region, …) minus modelId. */
  baseOptions: Omit<ResolveModelOptions, 'modelId'>;
}): ModelProvider {
  const { models, defaultModelId, baseOptions } = args;

  const allowed = new Set(models.map(m => m.id));
  allowed.add(defaultModelId);

  const cache = new Map<string, Promise<unknown>>();
  const resolve = (id: string): Promise<unknown> => {
    let pending = cache.get(id);
    if (!pending) {
      pending = resolveModel({ ...baseOptions, modelId: id });
      cache.set(id, pending);
    }
    return pending;
  };

  return {
    list: () => models,
    defaultId: () => defaultModelId,
    async get(id: string) {
      if (!allowed.has(id)) {
        throw new InputError(
          `model '${id}' is not allowed; configure it under catalogAssistant.models`,
        );
      }
      return resolve(id);
    },
  };
}
