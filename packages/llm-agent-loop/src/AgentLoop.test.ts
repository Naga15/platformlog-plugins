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
import {
  AgentLoop,
  AgentStepFn,
  DEFAULT_PRICING,
  StepResult,
  StopConditions,
} from './AgentLoop';
import { Tool, ToolRegistry } from './Tool';

const baseStops: StopConditions = {
  maxSteps: 12,
  maxToolCalls: 20,
  maxWallclockMs: 60_000,
  maxTokens: 30_000,
  maxCostUsd: 0.5,
};

const echo: Tool<{ msg: string }, { echoed: string }> = {
  name: 'echo',
  description: 'echo the message back',
  kind: 'read',
  inputSchema: z.object({ msg: z.string().min(1) }),
  async handler({ msg }) {
    return { payload: { echoed: msg }, text: `got: ${msg}` };
  },
};

const proposeNothing: Tool<{ label: string }, { label: string }> = {
  name: 'propose_nothing',
  description: 'returns a fake proposal',
  kind: 'propose',
  inputSchema: z.object({ label: z.string() }),
  async handler({ label }) {
    return { payload: { label }, text: `drafted: ${label}` };
  },
};

const scriptedStep = (
  sequence: StepResult[],
): jest.MockedFunction<AgentStepFn> =>
  jest.fn().mockImplementation(async () => {
    if (sequence.length === 0) {
      return {
        toolCalls: [],
        text: 'done',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
      } as StepResult;
    }
    return sequence.shift()!;
  });

describe('AgentLoop', () => {
  let t = 1000;
  const now = () => {
    t += 10;
    return t;
  };
  beforeEach(() => {
    t = 1000;
  });

  const buildRegistry = () => new ToolRegistry([echo, proposeNothing]);

  const runInput = {
    system: 'sys',
    initialUserMessage: 'go',
    data: { entityRef: 'component:default/x' },
  };

  it('happy path: tool call → tool result → llm-stop', async () => {
    const step = scriptedStep([
      {
        toolCalls: [{ id: 'c1', name: 'echo', args: { msg: 'hi' } }],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'tool-calls',
      },
      {
        toolCalls: [],
        text: 'all done',
        usage: { inputTokens: 50, outputTokens: 30 },
        finishReason: 'stop',
      },
    ]);
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      baseStops,
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.stopped).toBe('llm-stop');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].toolName).toBe('echo');
    expect(result.trace[0].toolKind).toBe('read');
    expect(result.trace[0].payload).toEqual({ echoed: 'hi' });
    expect(result.finalText).toBe('all done');
  });

  it('stops on max-steps', async () => {
    const step: AgentStepFn = jest.fn().mockResolvedValue({
      toolCalls: [{ id: 'c', name: 'echo', args: { msg: 'loop' } }],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: 'tool-calls',
    });
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      { ...baseStops, maxSteps: 3, maxToolCalls: 100 },
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.stopped).toBe('max-steps');
    expect(result.budgets.steps).toBe(3);
  });

  it('stops on tool-call-cap', async () => {
    const step: AgentStepFn = jest.fn().mockResolvedValue({
      toolCalls: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        name: 'echo',
        args: { msg: `x${i}` },
      })),
      usage: { inputTokens: 50, outputTokens: 20 },
      finishReason: 'tool-calls',
    });
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      { ...baseStops, maxToolCalls: 3 },
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.stopped).toBe('tool-call-cap');
    expect(result.budgets.toolCalls).toBe(3);
  });

  it('stops on token-budget', async () => {
    const step: AgentStepFn = jest.fn().mockResolvedValue({
      toolCalls: [{ id: 'c1', name: 'echo', args: { msg: 'big' } }],
      usage: { inputTokens: 5_000, outputTokens: 5_000 },
      finishReason: 'tool-calls',
    });
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      { ...baseStops, maxTokens: 8_000 },
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.stopped).toBe('token-budget');
  });

  it('stops on cost-cap (with token budget lifted out of the way)', async () => {
    const step: AgentStepFn = jest.fn().mockResolvedValue({
      toolCalls: [{ id: 'c1', name: 'echo', args: { msg: '$' } }],
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
      finishReason: 'tool-calls',
    });
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      {
        ...baseStops,
        maxTokens: 100_000_000,
        maxCostUsd: 1.0,
      },
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.stopped).toBe('cost-cap');
    expect(result.budgets.costUsd).toBeGreaterThan(1.0);
  });

  it('schema-rejects bad input as a tool error (does not throw)', async () => {
    const step = scriptedStep([
      {
        toolCalls: [
          { id: 'c1', name: 'echo', args: { msg: '' } }, // empty -> schema fail
        ],
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'tool-calls',
      },
      {
        toolCalls: [],
        text: 'gave up',
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'stop',
      },
    ]);
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      baseStops,
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.trace[0].error).toMatch(/invalid arguments for tool 'echo'/);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tool 'echo' error: invalid arguments/),
      ]),
    );
  });

  it('unknown tool calls become tool errors fed back to the LLM', async () => {
    const step = scriptedStep([
      {
        toolCalls: [{ id: 'c1', name: 'destroy_production', args: {} }],
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'tool-calls',
      },
      {
        toolCalls: [],
        text: 'understood',
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'stop',
      },
    ]);
    const loop = new AgentLoop(
      'm',
      step,
      buildRegistry(),
      baseStops,
      DEFAULT_PRICING,
      now,
    );
    const result = await loop.run(runInput);
    expect(result.trace[0].error).toMatch(/unknown tool: 'destroy_production'/);
  });

  it('threads data into every tool handler via the AgentToolContext', async () => {
    const seen: unknown[] = [];
    const dataAwareTool: Tool<{}, unknown, { entityRef: string }> = {
      name: 'see_data',
      description: 'records the data',
      kind: 'read',
      inputSchema: z.object({}),
      async handler(_input, ctx) {
        seen.push(ctx.data.entityRef);
        return { text: 'ok' };
      },
    };
    const reg = new ToolRegistry([dataAwareTool]);
    const step = scriptedStep([
      {
        toolCalls: [{ id: 'c1', name: 'see_data', args: {} }],
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'tool-calls',
      },
      {
        toolCalls: [],
        text: 'done',
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'stop',
      },
    ]);
    const loop = new AgentLoop('m', step, reg, baseStops, DEFAULT_PRICING, now);
    await loop.run({
      system: 's',
      initialUserMessage: 'go',
      data: { entityRef: 'component:default/orders-api' },
    });
    expect(seen).toEqual(['component:default/orders-api']);
  });
});
