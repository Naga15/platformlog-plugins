# @theplatformlog/llm-agent-loop

A small, framework-agnostic LLM-in-a-loop primitive. Use it for any
tool-calling agent where you want **propose-only writes, schema-validated
inputs, and independent budget caps** — five of them, each enforcing a
different worry.

Backstage-agnostic. Zero runtime deps except `zod`. Works with Vercel AI
SDK, OpenAI's chat completions, Anthropic's messages API, or any other
tool-calling primitive — via a single `AgentStepFn` seam.

[![npm version](https://img.shields.io/npm/v/@theplatformlog/llm-agent-loop.svg?style=flat-square)](https://www.npmjs.com/package/@theplatformlog/llm-agent-loop)
[![npm downloads](https://img.shields.io/npm/dm/@theplatformlog/llm-agent-loop.svg?style=flat-square)](https://www.npmjs.com/package/@theplatformlog/llm-agent-loop)

## Install

```bash
npm install @theplatformlog/llm-agent-loop zod
```

## Use

```ts
import { z } from 'zod';
import {
  AgentLoop,
  ToolRegistry,
  DEFAULT_STOP_CONDITIONS,
  type AgentStepFn,
} from '@theplatformlog/llm-agent-loop';

const tools = new ToolRegistry([
  {
    name: 'query_logs',
    description: 'Fetch log lines for a service in a time window.',
    kind: 'read',
    inputSchema: z.object({
      service: z.string(),
      since: z.string().datetime(),
      until: z.string().datetime(),
    }),
    async handler(input) {
      const lines = await myLogsApi.query(input);
      return { payload: { lines }, text: `Returned ${lines.length} lines` };
    },
  },
  {
    name: 'propose_rollback',
    description: 'Propose an ArgoCD rollback. Never executes.',
    kind: 'propose',  // ← part of the type, not the handler return value
    inputSchema: z.object({
      app: z.string(),
      revision: z.string(),
    }),
    async handler(input) {
      const action = { label: `Rollback ${input.app} to ${input.revision}`, destructive: true };
      return { payload: action, text: `Drafted: ${action.label}` };
    },
  },
]);

// Plug in your favorite SDK. This is the only place you touch a model SDK.
const step: AgentStepFn = async ({ messages, tools }) => {
  const r = await myVercelAiSdkWrapper.generateText({ messages, tools });
  return {
    toolCalls: r.toolCalls,
    text: r.text,
    usage: r.usage,
    finishReason: r.finishReason,
  };
};

const loop = new AgentLoop(myModel, step, tools, DEFAULT_STOP_CONDITIONS);
const result = await loop.run({
  system: 'You are an SRE assistant.',
  initialUserMessage: 'Investigate the orders-api p99 spike at 14:08.',
  data: { entityRef: 'component:default/orders-api' },
});

console.log(result.stopped);    // 'llm-stop' | 'max-steps' | 'tool-call-cap' | 'token-budget' | 'wallclock' | 'cost-cap'
console.log(result.budgets);    // { steps, toolCalls, inputTokens, outputTokens, costUsd, elapsedMs }
console.log(result.trace);      // one entry per tool call, with payload + kind + duration
```

## Why this design

### Three tool kinds, baked into the type

```ts
readonly kind: 'read' | 'propose' | 'record' | (string & {});
```

`kind` is **part of the Tool interface**, not something handlers return.
You can grep your registry to see exactly which tools can propose writes,
full stop. The library doesn't *enforce* that `propose` tools don't side-
effect (you're an adult, you control the handlers) — it gives you the
audit surface to verify they don't.

### Five independent stop conditions

```ts
const DEFAULT_STOP_CONDITIONS = {
  maxSteps: 12,           // architectural depth
  maxToolCalls: 20,       // per-step explosion
  maxWallclockMs: 60_000, // operator-visible latency
  maxTokens: 30_000,      // model-API budget
  maxCostUsd: 0.5,        // dollar cap (uses ModelPricing)
};
```

Any one trips → loop ends → result tagged with which one.

The first three are pre-step checks (capped *before* the next model
call). `maxTokens` and `maxCostUsd` use cumulative usage from prior
steps; `maxCostUsd` is computed from `ModelPricing` (defaults to Claude
Sonnet-class).

### Schema validation per call, errors fed back to the model

```ts
const result = await toolRegistry.invoke(name, rawInput, ctx);
// Unknown tool → { error: "unknown tool: 'destroy_production'" }
// Bad schema  → { error: "invalid arguments for tool '...'" }
// Handler throws → { error: "tool '...' threw: ..." }
```

None of these throw out of the loop. The model sees the error as the
tool's response and can self-correct on the next step.

### SDK seam: AgentStepFn

The loop never imports a model SDK. You provide:

```ts
type AgentStepFn = (args: {
  model: unknown;
  system: string;
  messages: AgentMessage[];
  tools: Tool[];
}) => Promise<StepResult>;
```

`StepResult` is `{ toolCalls, text?, usage, finishReason }`. Wrap your
SDK's `generateText({ tools })` or equivalent. Tests inject a scripted
stub — see [`AgentLoop.test.ts`](./src/AgentLoop.test.ts) for the pattern.

## What's NOT here

- **Prompt construction.** You build messages; this loop runs them.
- **Memory / persistence.** Each `run()` is independent.
- **Tool definitions for any specific domain.** No `propose_rollback`,
  no Datadog/GitHub/etc. tools — those are domain layers you compose on
  top.
- **Streaming.** The loop is request-response per step.

## Background

Extracted from the agent loop in [Backstage incident-investigation
co-pilot](https://theplatformlog.dev/agent-loop). The original
description: *what earns the word "agent" vs. "co-pilot" isn't the
model — it's the surface*. This package is that surface, minus the
incident-specific framing.

## License

Apache-2.0 © Naga15.
