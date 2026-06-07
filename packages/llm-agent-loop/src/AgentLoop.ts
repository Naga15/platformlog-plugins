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

import {
  AgentToolContext,
  Tool,
  ToolRegistry,
  ToolResult,
} from './Tool';

/**
 * Budgets that cap a run. Any single condition trips and the loop ends.
 *
 * @public
 */
export interface StopConditions {
  /** Max LLM/tool steps. Each step = one model call + its tool calls. */
  maxSteps: number;
  /** Max individual tool invocations across all steps. */
  maxToolCalls: number;
  /** Wallclock cap in milliseconds. */
  maxWallclockMs: number;
  /** Sum of input + output tokens. */
  maxTokens: number;
  /** Dollar cap. Implementation uses the injected ModelPricing. */
  maxCostUsd: number;
}

/**
 * Defaults sized for an SRE-incident assistant on Claude Sonnet-class:
 * 12 steps, 20 tool calls, 60s wallclock, 30k tokens, $0.50 ceiling.
 *
 * @public
 */
export const DEFAULT_STOP_CONDITIONS: StopConditions = {
  maxSteps: 12,
  maxToolCalls: 20,
  maxWallclockMs: 60_000,
  maxTokens: 30_000,
  maxCostUsd: 0.5,
};

/**
 * USD per 1M tokens. Default matches Claude Sonnet 4.6 published
 * pricing as of mid-2026. Override per model.
 *
 * @public
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * @public
 */
export const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
};

/**
 * Shape returned by the injected `step` function. Trimmed to what the
 * loop actually needs — wrap the real LLM SDK (Vercel AI SDK, OpenAI,
 * Anthropic) and produce one of these per step.
 *
 * @public
 */
export interface StepResult {
  toolCalls: Array<{
    id: string;
    name: string;
    args: unknown;
  }>;
  text?: string;
  usage: { inputTokens: number; outputTokens: number };
  finishReason: 'stop' | 'tool-calls' | 'length' | 'error' | (string & {});
}

/**
 * Chat-style message the loop maintains. Mirrors OpenAI/Anthropic
 * tool-result conventions so wiring to a real SDK is mechanical.
 *
 * @public
 */
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content?: string;
      toolCalls?: Array<{ id: string; name: string; args: unknown }>;
    }
  | { role: 'tool'; toolCallId: string; content: string };

/**
 * The function that drives one LLM call per loop iteration. Real
 * implementation wraps your SDK's tool-calling primitive; tests inject
 * a scripted stub.
 *
 * @public
 */
export type AgentStepFn<TData = unknown> = (args: {
  model: unknown;
  system: string;
  messages: AgentMessage[];
  tools: Tool<any, any, TData>[];
}) => Promise<StepResult>;

/**
 * Single trace entry per tool call.
 *
 * @public
 */
export interface AgentTraceEntry<TPayload = unknown> {
  step: number;
  callIndex: number;
  toolName: string;
  toolKind: Tool['kind'];
  args: unknown;
  payload?: TPayload;
  error?: string;
  durationMs: number;
}

/**
 * Reasons a run ends.
 *
 * @public
 */
export type AgentStopReason =
  | 'llm-stop'
  | 'max-steps'
  | 'tool-call-cap'
  | 'token-budget'
  | 'wallclock'
  | 'cost-cap';

/**
 * Final result of a loop run.
 *
 * @public
 */
export interface AgentRunResult<TPayload = unknown> {
  trace: AgentTraceEntry<TPayload>[];
  stopped: AgentStopReason;
  budgets: {
    steps: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    elapsedMs: number;
  };
  warnings: string[];
  /** Any text the LLM emitted on its terminating step. */
  finalText?: string;
}

/**
 * The LLM-in-a-loop investigation runner.
 *
 * Lifecycle of one `run()`:
 *   1. Pre-step budget check (wallclock + tokens + cost). If trips,
 *      return WITHOUT consuming the next model call.
 *   2. step() → process tool calls via ToolRegistry.invoke().
 *   3. If no tool calls AND finishReason is 'stop' → llm-stop.
 *   4. Loop until maxSteps.
 *
 * @public
 */
export class AgentLoop<TData = unknown, TPayload = unknown> {
  constructor(
    private readonly model: unknown,
    private readonly step: AgentStepFn<TData>,
    private readonly tools: ToolRegistry<TData>,
    private readonly stopConditions: StopConditions = DEFAULT_STOP_CONDITIONS,
    private readonly pricing: ModelPricing = DEFAULT_PRICING,
    private readonly now: () => number = Date.now,
  ) {}

  async run(input: {
    system: string;
    initialUserMessage: string;
    /** Run-scoped data passed to every tool handler via AgentToolContext.data */
    data: TData;
  }): Promise<AgentRunResult<TPayload>> {
    const startedAt = this.now();
    const messages: AgentMessage[] = [
      { role: 'system', content: input.system },
      { role: 'user', content: input.initialUserMessage },
    ];

    const trace: AgentTraceEntry<TPayload>[] = [];
    const warnings: string[] = [];

    let totalSteps = 0;
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText: string | undefined;

    const computeCost = () =>
      (totalInputTokens / 1_000_000) * this.pricing.inputPerMillion +
      (totalOutputTokens / 1_000_000) * this.pricing.outputPerMillion;
    const elapsed = () => this.now() - startedAt;

    const finalize = (
      reason: AgentStopReason,
    ): AgentRunResult<TPayload> => ({
      trace,
      stopped: reason,
      budgets: {
        steps: totalSteps,
        toolCalls: totalToolCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: computeCost(),
        elapsedMs: elapsed(),
      },
      warnings,
      finalText,
    });

    while (totalSteps < this.stopConditions.maxSteps) {
      if (elapsed() > this.stopConditions.maxWallclockMs) {
        return finalize('wallclock');
      }
      if (
        totalInputTokens + totalOutputTokens >
        this.stopConditions.maxTokens
      ) {
        return finalize('token-budget');
      }
      if (computeCost() > this.stopConditions.maxCostUsd) {
        return finalize('cost-cap');
      }

      totalSteps += 1;

      const result = await this.step({
        model: this.model,
        system: input.system,
        messages,
        tools: this.tools.list(),
      });

      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;

      messages.push({
        role: 'assistant',
        content: result.text,
        toolCalls: result.toolCalls,
      });

      if (result.toolCalls.length === 0) {
        finalText = result.text;
        return finalize('llm-stop');
      }

      for (const call of result.toolCalls) {
        if (totalToolCalls >= this.stopConditions.maxToolCalls) {
          return finalize('tool-call-cap');
        }
        totalToolCalls += 1;

        const callStart = this.now();
        const toolCtx: AgentToolContext<TData> = {
          data: input.data,
          callIndex: totalToolCalls,
        };

        const toolResult = await this.tools.invoke(
          call.name,
          call.args,
          toolCtx,
        );
        const durationMs = this.now() - callStart;

        const toolDef = this.tools.get(call.name);
        const traceEntry: AgentTraceEntry<TPayload> = {
          step: totalSteps,
          callIndex: totalToolCalls,
          toolName: call.name,
          toolKind: toolDef?.kind ?? 'unknown',
          args: call.args,
          durationMs,
        };

        if (toolResult.error) {
          traceEntry.error = toolResult.error;
          warnings.push(`tool '${call.name}' error: ${toolResult.error}`);
        }
        if (toolResult.payload !== undefined) {
          traceEntry.payload = toolResult.payload as TPayload;
        }

        trace.push(traceEntry);

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: toolResult.error ?? toolResult.text ?? '(no text)',
        });
      }
    }

    return finalize('max-steps');
  }
}

/**
 * Convenience re-export so callers don't need a separate import.
 *
 * @public
 */
export type { ToolResult };
