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

import { mockServices } from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import { CatalogContextRetriever } from './CatalogContextRetriever';
import { QueryService } from './QueryService';

const fakeRetriever = (entities: Entity[]): CatalogContextRetriever =>
  ({
    retrieve: jest.fn().mockResolvedValue(
      entities.map((entity, i) => ({
        entity,
        entityRef: `component:default/${entity.metadata.name}`,
        score: 100 - i,
      })),
    ),
  } as unknown as CatalogContextRetriever);

const entity = (name: string, extra: Record<string, unknown> = {}): Entity =>
  ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name },
    spec: { type: 'service', owner: 'group:platform', ...extra },
  } as Entity);

describe('QueryService', () => {
  const logger = mockServices.logger.mock();

  it('returns a no-context message when retriever finds nothing', async () => {
    const generateText = jest.fn();
    const svc = new QueryService(
      fakeRetriever([]),
      'mock-model',
      generateText,
      logger,
      256,
    );

    const result = await svc.query('what is x?');

    expect(result.answer).toMatch(/couldn't find/i);
    expect(result.citations).toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('passes a grounded prompt to generateText and returns the answer', async () => {
    const generateText = jest
      .fn()
      .mockResolvedValue({ text: '  group:platform owns payments-api  ' });
    const svc = new QueryService(
      fakeRetriever([entity('payments-api')]),
      'mock-model',
      generateText,
      logger,
      256,
    );

    const result = await svc.query('who owns payments?');

    expect(result.answer).toEqual('group:platform owns payments-api');
    expect(result.citations).toEqual(['component:default/payments-api']);

    const call = generateText.mock.calls[0][0];
    expect(call.model).toEqual('mock-model');
    expect(call.system).toMatch(/Backstage software catalog/);
    // The grounded content is the last (current) user message.
    const lastTurn = call.messages[call.messages.length - 1];
    expect(lastTurn.role).toEqual('user');
    expect(lastTurn.content).toContain('component:default/payments-api');
    expect(lastTurn.content).toContain('owner: group:platform');
    expect(lastTurn.content).toContain('Question: who owns payments?');
    expect(call.maxOutputTokens).toEqual(256);
  });

  it('threads prior conversation turns before the grounded question', async () => {
    const generateText = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = new QueryService(
      fakeRetriever([entity('payments-api')]),
      'mock-model',
      generateText,
      logger,
      256,
    );

    await svc.query('who owns it?', {
      history: [
        { role: 'user', content: 'tell me about payments-api' },
        { role: 'assistant', content: 'payments-api handles payments.' },
      ],
    });

    const { messages } = generateText.mock.calls[0][0];
    expect(messages).toHaveLength(3); // 2 history + 1 grounded current turn
    expect(messages[0]).toEqual({
      role: 'user',
      content: 'tell me about payments-api',
    });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: 'payments-api handles payments.',
    });
    expect(messages[2].role).toEqual('user');
    expect(messages[2].content).toContain('Question: who owns it?');
  });

  it('throws InputError on an empty question', async () => {
    const svc = new QueryService(
      fakeRetriever([]),
      'mock-model',
      jest.fn(),
      logger,
      256,
    );

    await expect(svc.query('   ')).rejects.toThrow(/must not be empty/);
  });

  it('forwards caller credentials to the retriever', async () => {
    const retriever = fakeRetriever([entity('a')]);
    const svc = new QueryService(
      retriever,
      'mock-model',
      jest.fn().mockResolvedValue({ text: 'ok' }),
      logger,
      256,
    );

    await svc.query('a', { credentials: { token: 't0k' } });

    expect(retriever.retrieve).toHaveBeenCalledWith('a', {
      credentials: { token: 't0k' },
    });
  });

  it('resolves a per-request model via the model provider', async () => {
    const generateText = jest.fn().mockResolvedValue({ text: 'ok' });
    const modelProvider = {
      list: () => [{ id: 'nova', label: 'Nova' }],
      defaultId: () => 'default-model',
      get: jest.fn().mockResolvedValue('nova-model'),
    };
    const svc = new QueryService(
      fakeRetriever([entity('a')]),
      'default-model',
      generateText,
      logger,
      256,
      modelProvider,
    );

    await svc.query('a', { model: 'nova' });

    expect(modelProvider.get).toHaveBeenCalledWith('nova');
    expect(generateText.mock.calls[0][0].model).toEqual('nova-model');
  });

  it('uses the default model when no override is given', async () => {
    const generateText = jest.fn().mockResolvedValue({ text: 'ok' });
    const modelProvider = {
      list: () => [],
      defaultId: () => 'default-model',
      get: jest.fn(),
    };
    const svc = new QueryService(
      fakeRetriever([entity('a')]),
      'default-model',
      generateText,
      logger,
      256,
      modelProvider,
    );

    await svc.query('a');

    expect(modelProvider.get).not.toHaveBeenCalled();
    expect(generateText.mock.calls[0][0].model).toEqual('default-model');
  });

  it('exposes the model list and default from the provider', () => {
    const modelProvider = {
      list: () => [{ id: 'nova', label: 'Nova' }],
      defaultId: () => 'default-model',
      get: jest.fn(),
    };
    const svc = new QueryService(
      fakeRetriever([]),
      'default-model',
      jest.fn(),
      logger,
      256,
      modelProvider,
    );

    expect(svc.listModels()).toEqual([{ id: 'nova', label: 'Nova' }]);
    expect(svc.defaultModelId()).toEqual('default-model');
  });

  it('includes entity relations in the prompt when present', async () => {
    const generateText = jest.fn().mockResolvedValue({ text: 'ok' });
    const svc = new QueryService(
      fakeRetriever([
        entity('payments-api', {
          dependsOn: ['resource:default/payments-db'],
          providesApis: ['api:default/payments'],
        }),
      ]),
      'mock-model',
      generateText,
      logger,
      256,
    );

    await svc.query('payments');

    const { messages } = generateText.mock.calls[0][0];
    const content = messages[messages.length - 1].content as string;
    expect(content).toContain('dependsOn: resource:default/payments-db');
    expect(content).toContain('providesApis: api:default/payments');
  });
});
