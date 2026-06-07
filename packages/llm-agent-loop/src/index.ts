/*
 * Copyright 2026 theplatformlog.dev
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * `@theplatformlog/llm-agent-loop` — a small, framework-agnostic
 * LLM-in-a-loop primitive.
 *
 * What it gives you:
 *  - `Tool` interface with `kind` baked into the type (`read | propose | record`)
 *  - `ToolRegistry` that validates input via zod *before* the handler runs
 *  - `AgentLoop` that runs the LLM-in-a-loop with **five independent stop
 *    conditions** (steps, tool calls, wallclock, tokens, cost)
 *  - SDK-agnostic via a single `AgentStepFn` seam — wrap Vercel AI SDK's
 *    `generateText({ tools })`, OpenAI's chat completions, Anthropic's
 *    messages API, or any other tool-calling primitive.
 *
 * @packageDocumentation
 */

export {
  ToolRegistry,
  type AgentToolContext,
  type Tool,
  type ToolResult,
} from './Tool';

export {
  AgentLoop,
  DEFAULT_PRICING,
  DEFAULT_STOP_CONDITIONS,
  type AgentMessage,
  type AgentRunResult,
  type AgentStepFn,
  type AgentStopReason,
  type AgentTraceEntry,
  type ModelPricing,
  type StepResult,
  type StopConditions,
} from './AgentLoop';
