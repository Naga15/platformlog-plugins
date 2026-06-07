/*
 * Copyright 2026 theplatformlog.dev
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
 */

import { z } from 'zod';

/**
 * Context every tool handler has access to. Threaded by AgentLoop;
 * `data` is a user-supplied bag for run-scoped state (entity refs,
 * time windows, request ids, etc.) that handlers may need.
 *
 * @public
 */
export interface AgentToolContext<TData = unknown> {
  data: TData;
  /** Monotonic counter across the run; stable for id assignment. */
  callIndex: number;
}

/**
 * Result a tool handler returns. The loop accumulates by kind via the
 * `accumulate` reducer you pass to `AgentLoop`. Use `payload` for any
 * domain-specific data (evidence items, suggested actions, recorded
 * claims) and `text` for the message the LLM sees as the tool's
 * response.
 *
 * `error` is used when zod validation fails or the handler throws —
 * the loop converts these into LLM-visible tool responses so the model
 * can self-correct rather than crash.
 *
 * @public
 */
export interface ToolResult<TPayload = unknown> {
  payload?: TPayload;
  text?: string;
  error?: string;
}

/**
 * One tool the agent loop may call. `inputSchema` is enforced *before*
 * `handler` runs; invalid inputs become tool errors, not exceptions.
 *
 * `kind` is a coarse tag for policy/budget/audit. Treat it as part of
 * the type, not a string the handler returns — you should be able to
 * grep the registry to see which tools are propose-class.
 *
 * @public
 */
export interface Tool<TInput = unknown, TPayload = unknown, TData = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<TInput>;
  readonly kind: 'read' | 'propose' | 'record' | (string & {});
  handler(
    input: TInput,
    ctx: AgentToolContext<TData>,
  ): Promise<ToolResult<TPayload>>;
}

/**
 * Lookup + schema-validating dispatcher. The agent loop calls
 * `invoke()` rather than touching `Tool.handler` directly so input
 * validation can't be skipped.
 *
 * @public
 */
export class ToolRegistry<TData = unknown> {
  private readonly map: Map<string, Tool<any, any, TData>>;

  constructor(tools: Tool<any, any, TData>[]) {
    this.map = new Map();
    for (const t of tools) {
      if (this.map.has(t.name)) {
        throw new Error(`duplicate tool registration: ${t.name}`);
      }
      this.map.set(t.name, t);
    }
  }

  list(): Tool<any, any, TData>[] {
    return [...this.map.values()];
  }

  get(name: string): Tool<any, any, TData> | undefined {
    return this.map.get(name);
  }

  async invoke(
    name: string,
    rawInput: unknown,
    ctx: AgentToolContext<TData>,
  ): Promise<ToolResult> {
    const tool = this.map.get(name);
    if (!tool) {
      return { error: `unknown tool: '${name}'` };
    }
    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        error: `invalid arguments for tool '${name}': ${parsed.error.message}`,
      };
    }
    try {
      return await tool.handler(parsed.data as never, ctx);
    } catch (e) {
      return { error: `tool '${name}' threw: ${(e as Error).message}` };
    }
  }
}
