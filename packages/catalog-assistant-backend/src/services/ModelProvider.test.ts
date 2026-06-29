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

import { createModelProvider } from './ModelProvider';

describe('createModelProvider', () => {
  const baseOptions = { provider: 'anthropic', apiKey: 'test-key' };

  it('lists configured models and reports the default', () => {
    const provider = createModelProvider({
      models: [
        { id: 'claude-haiku-4-5', label: 'Haiku' },
        { id: 'claude-opus-4-8', label: 'Opus' },
      ],
      defaultModelId: 'claude-haiku-4-5',
      baseOptions,
    });

    expect(provider.list()).toEqual([
      { id: 'claude-haiku-4-5', label: 'Haiku' },
      { id: 'claude-opus-4-8', label: 'Opus' },
    ]);
    expect(provider.defaultId()).toEqual('claude-haiku-4-5');
  });

  it('rejects a model that is not in the allowlist', async () => {
    const provider = createModelProvider({
      models: [{ id: 'claude-haiku-4-5', label: 'Haiku' }],
      defaultModelId: 'claude-haiku-4-5',
      baseOptions,
    });

    await expect(provider.get('claude-opus-4-8')).rejects.toThrow(
      /not allowed/,
    );
  });

  it('allows the default model even when not listed', async () => {
    const provider = createModelProvider({
      models: [],
      defaultModelId: 'claude-haiku-4-5',
      baseOptions,
    });

    await expect(provider.get('claude-haiku-4-5')).resolves.toBeDefined();
  });

  it('resolves an allowed model and caches the result', async () => {
    const provider = createModelProvider({
      models: [{ id: 'claude-haiku-4-5', label: 'Haiku' }],
      defaultModelId: 'claude-haiku-4-5',
      baseOptions,
    });

    const first = await provider.get('claude-haiku-4-5');
    const second = await provider.get('claude-haiku-4-5');

    expect(first).toBeDefined();
    // Cached: the same model instance is returned, not rebuilt.
    expect(first).toBe(second);
  });
});
