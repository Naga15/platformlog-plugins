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

import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import {
  CatalogAssistantApi,
  ChatMessage,
  ModelsResponse,
  QueryResult,
} from './types';

/**
 * Talks to the `catalog-assistant` backend plugin. The `fetchApi` automatically
 * attaches the caller's Backstage token, so the backend's httpAuth check passes.
 */
export class CatalogAssistantClient implements CatalogAssistantApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly fetchApi: FetchApi,
  ) {}

  private async baseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('catalog-assistant');
  }

  async listModels(): Promise<ModelsResponse> {
    const res = await this.fetchApi.fetch(`${await this.baseUrl()}/v1/models`);
    if (!res.ok) {
      throw await toError(res);
    }
    return (await res.json()) as ModelsResponse;
  }

  async query(
    question: string,
    model?: string,
    history?: ChatMessage[],
  ): Promise<QueryResult> {
    const res = await this.fetchApi.fetch(`${await this.baseUrl()}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        ...(model ? { model } : {}),
        ...(history && history.length ? { history } : {}),
      }),
    });
    if (!res.ok) {
      throw await toError(res);
    }
    return (await res.json()) as QueryResult;
  }
}

async function toError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? JSON.stringify(body);
  } catch {
    detail = await res.text().catch(() => '');
  }
  return new Error(
    `catalog-assistant request failed (${res.status} ${res.statusText}): ${detail}`,
  );
}
