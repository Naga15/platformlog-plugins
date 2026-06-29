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

import { createApiRef } from '@backstage/core-plugin-api';

/** A selectable model: `id` is sent to the backend, `label` is shown in the UI. */
export interface ModelOption {
  id: string;
  label: string;
}

/** Response of `GET /v1/models`. */
export interface ModelsResponse {
  models: ModelOption[];
  default?: string;
}

/** Response of `POST /v1/query`. */
export interface QueryResult {
  answer: string;
  citations: string[];
}

/** Client for the catalog-assistant backend plugin. */
export interface CatalogAssistantApi {
  listModels(): Promise<ModelsResponse>;
  query(question: string, model?: string): Promise<QueryResult>;
}

export const catalogAssistantApiRef = createApiRef<CatalogAssistantApi>({
  id: 'plugin.catalog-assistant.service',
});
