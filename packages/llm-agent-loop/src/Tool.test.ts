/*
 * Copyright 2026 theplatformlog.dev
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { AgentToolContext, Tool, ToolRegistry } from './Tool';

const ctx: AgentToolContext = { data: undefined, callIndex: 1 };

const echo: Tool<{ msg: string }> = {
  name: 'echo',
  description: 'echo',
  kind: 'read',
  inputSchema: z.object({ msg: z.string().min(1) }),
  async handler(input) {
    return { text: input.msg };
  },
};

describe('ToolRegistry', () => {
  it('throws on duplicate registration', () => {
    expect(() => new ToolRegistry([echo, echo])).toThrow(/duplicate tool/);
  });

  it('invokes a tool with valid input', async () => {
    const reg = new ToolRegistry([echo]);
    const result = await reg.invoke('echo', { msg: 'hello' }, ctx);
    expect(result.text).toEqual('hello');
    expect(result.error).toBeUndefined();
  });

  it('returns an error for an unknown tool name (does not throw)', async () => {
    const reg = new ToolRegistry([echo]);
    const result = await reg.invoke('missing', {}, ctx);
    expect(result.error).toMatch(/unknown tool: 'missing'/);
  });

  it('returns an error for input that fails schema validation', async () => {
    const reg = new ToolRegistry([echo]);
    const result = await reg.invoke('echo', { msg: '' }, ctx);
    expect(result.error).toMatch(/invalid arguments for tool 'echo'/);
  });

  it('catches handler throws and surfaces as tool error', async () => {
    const boom: Tool = {
      name: 'boom',
      description: 'boom',
      kind: 'read',
      inputSchema: z.object({}),
      async handler() {
        throw new Error('handler-died');
      },
    };
    const reg = new ToolRegistry([boom]);
    const result = await reg.invoke('boom', {}, ctx);
    expect(result.error).toMatch(/tool 'boom' threw: handler-died/);
  });
});
