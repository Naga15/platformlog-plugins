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

/**
 * Frontend plugin for the catalog-assistant: a page with a question prompt, a
 * model dropdown (from the backend allowlist), and a grounded answer + citations.
 *
 * @packageDocumentation
 */

export {
  catalogAssistantPlugin,
  CatalogAssistantPage,
  CatalogAssistantChat,
} from './plugin';
export { catalogAssistantApiRef } from './api/types';
export type {
  CatalogAssistantApi,
  ModelOption,
  ModelsResponse,
  QueryResult,
} from './api/types';
export { rootRouteRef } from './routes';
