# Catalog Assistant Backend

A Backstage backend plugin that answers natural-language questions about the
Software Catalog using an LLM, grounded on catalog entities.

Ask things like:

- _"Who owns the payments service?"_
- _"What services depend on auth-db?"_
- _"Which components are tagged `tier-1` and use Postgres?"_

The plugin retrieves the top-N relevant catalog entities for a question,
builds a grounded prompt, and asks Claude to answer using only those entities
as the source of truth. The response includes the entity refs cited as
context so the caller can verify or link them.

## Status

First slice. Backend HTTP endpoint only, no UI. Retrieval is keyword /
substring scoring across entity name, title, description, tags, kind, and
spec.type — intentionally simple and deterministic, no embedding store
required. Designed to be swapped behind the same `CatalogContextRetriever`
interface for semantic retrieval later.

## Installation

```bash
yarn --cwd packages/backend add @backstage/plugin-catalog-assistant-backend
```

Register the plugin:

```ts
// packages/backend/src/index.ts
backend.add(import('@theplatformlog/catalog-assistant-backend'));
```

## Configuration

```yaml
catalogAssistant:
  # LLM provider: anthropic (default) | openai | google | mistral | bedrock
  provider: anthropic
  # Model id for the chosen provider. Defaults to 'claude-opus-4-8'
  # for anthropic; required for any other provider.
  model: claude-opus-4-8
  # API key for the provider. If omitted, the provider SDK reads its
  # conventional env var (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.).
  apiKey: ${ANTHROPIC_API_KEY}
  # Defaults to 20
  maxContextEntities: 20
  # Defaults to 1024
  maxOutputTokens: 1024
```

### Selectable models (allowlist + dropdown)

Optionally expose several models that callers can pick per request (and that a
UI can show in a dropdown). The `model` above stays the default used when a
request doesn't specify one. Disable a model after testing by setting
`enabled: false` (or removing it):

```yaml
catalogAssistant:
  provider: bedrock
  awsRegion: us-east-1
  model: us.amazon.nova-lite-v1:0 # default when a request omits `model`
  models:
    - id: us.amazon.nova-lite-v1:0
      label: Nova Lite (cheap, default)
    - id: us.amazon.nova-micro-v1:0
      label: Nova Micro (cheapest)
    - id: us.anthropic.claude-haiku-4-5-v1:0
      label: Claude Haiku 4.5 (best quality)
      enabled: false # flip to true after you've tested it
```

The enabled models are served from `GET /v1/models` (for the dropdown), and a
`POST /v1/query` may include a `model` field — it must be one of the enabled
ids (or the default), otherwise the request is rejected with `400`. Omit the
`models` list entirely to run a single fixed model (the original behaviour).

`apiKey` is marked `secret` in the config schema; provide it via env var in
production. (`anthropicApiKey` is still accepted as a deprecated alias.)

### Using a non-Anthropic provider

`@ai-sdk/anthropic` ships with this plugin. To use another provider, install
its Vercel AI SDK package in your backend and set `provider` + `model`:

```bash
# OpenAI
yarn --cwd packages/backend add @ai-sdk/openai
```

```yaml
catalogAssistant:
  provider: openai
  model: gpt-5
  apiKey: ${OPENAI_API_KEY}
```

Supported providers: `anthropic`, `openai`, `google`, `mistral`, `bedrock`. Any
model id the chosen provider's SDK accepts works — Claude (`claude-opus-4-8`,
`claude-sonnet-4-6`, `claude-haiku-4-5`, …), GPT, Gemini, Mistral, etc.

### AWS Bedrock (IAM role / IRSA on EKS)

Use the `bedrock` provider to run any Bedrock-hosted model (Claude, Amazon Nova,
Llama, Mistral) through your AWS account. Install the provider and the AWS
credential resolver:

```bash
yarn --cwd packages/backend add @ai-sdk/amazon-bedrock @aws-sdk/credential-providers
```

**Recommended — no static keys (assume an IAM role).** With no `awsAccessKeyId`
configured, the plugin resolves the AWS default credential chain, so a role is
assumed automatically on EKS (IRSA / Pod Identity), EC2/ECS (instance role),
or locally (SSO / shared profile / `AWS_*` env vars):

```yaml
catalogAssistant:
  provider: bedrock
  # Bedrock model id or cross-region inference profile id. Copy the exact
  # value from the Bedrock console → Model catalog / Inference profiles
  # after enabling Model access for the model.
  model: us.anthropic.claude-opus-4-8-v1:0
  awsRegion: us-east-1
```

For **IRSA**, attach an IAM role allowing `bedrock:InvokeModel` (and
`bedrock:InvokeModelWithResponseStream`) on the model + inference-profile ARNs to
the backend's Kubernetes ServiceAccount — e.g. via
`eksctl create iamserviceaccount … --attach-policy-arn …`, or the
`eks.amazonaws.com/role-arn` SA annotation. See
[Use IRSA with the AWS SDK](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts-minimum-sdk.html).

**Static credentials** (local testing) — set `awsAccessKeyId` / `awsSecretAccessKey`
(both `secret`), or export a short-lived Bedrock API key as
`AWS_BEARER_TOKEN_BEDROCK`. `@aws-sdk/credential-providers` is not needed for the
static-key paths.

**Cost note:** Bedrock has no free models — every model is billed per token. For
grounded catalog Q&A the context is small and answers are short, so a cheap small
model is very cost-effective: **Amazon Nova Micro** (`amazon.nova-micro-v1:0`,
~$0.035/$0.14 per 1M in/out) or **Nova Lite** (`amazon.nova-lite-v1:0`) are the
cheapest; **Claude Haiku 4.5** is a strong middle option. Reserve Opus/Sonnet for
hard questions. For a truly $0 path, use the local Ollama setup below instead.

### Free and local models (cost-sensitive)

Two paths to $0 (or near-$0):

**Local — Ollama (truly free, runs Gemma 3 / Llama on your hardware).** Set the
`openai` provider's `baseURL` to Ollama's OpenAI-compatible endpoint:

```bash
ollama pull gemma3
yarn --cwd packages/backend add @ai-sdk/openai
```

```yaml
catalogAssistant:
  provider: openai
  model: gemma3            # or gemma3:27b, llama3.1, qwen2.5, …
  baseURL: http://localhost:11434/v1
  apiKey: ollama           # any non-empty value; Ollama ignores it
```

**Hosted free tiers.** Google AI Studio (`gemini-2.5-flash`) has a generous
free tier; Groq and OpenRouter serve Gemma 3 free/cheap and are OpenAI-compatible:

```yaml
# Google free tier
catalogAssistant: { provider: google, model: gemini-2.5-flash, apiKey: ${GOOGLE_GENERATIVE_AI_API_KEY} }

# Groq (free, fast) — serves Gemma
catalogAssistant: { provider: openai, model: gemma2-9b-it, baseURL: https://api.groq.com/openai/v1, apiKey: ${GROQ_API_KEY} }

# OpenRouter — free Gemma 3 variant
catalogAssistant: { provider: openai, model: "google/gemma-3-27b-it:free", baseURL: https://openrouter.ai/api/v1, apiKey: ${OPENROUTER_API_KEY} }
```

Because retrieval is deterministic and the prompt is grounded, a small free
model handles most catalog Q&A well — reserve a frontier model for hard cases.

## API

### `POST /api/catalog-assistant/v1/query`

Request (`model` and `history` are optional; `model` defaults to the configured
default; `history` carries prior turns for multi-turn follow-ups):

```json
{
  "question": "who owns it?",
  "model": "us.amazon.nova-lite-v1:0",
  "history": [
    { "role": "user", "content": "tell me about payments-api" },
    { "role": "assistant", "content": "payments-api handles payments." }
  ]
}
```

Response:

```json
{
  "answer": "The payments service is owned by group:default/platform.",
  "citations": ["component:default/payments-api", "api:default/payments"]
}
```

A `model` that is not in the enabled allowlist (and not the default) is
rejected with `400`.

### `GET /api/catalog-assistant/v1/models`

Lists the selectable models for a UI dropdown, plus the default:

```json
{
  "models": [
    { "id": "us.amazon.nova-lite-v1:0", "label": "Nova Lite (cheap, default)" },
    { "id": "us.amazon.nova-micro-v1:0", "label": "Nova Micro (cheapest)" }
  ],
  "default": "us.amazon.nova-lite-v1:0"
}
```

Returns an empty `models` list when no allowlist is configured.

Both endpoints authenticate via the standard Backstage `httpAuth` service and
accept either a user or service credential.

## Architecture

```
┌──────────────────┐    ┌──────────────────────────┐    ┌────────────────┐
│ HTTP /v1/query   │ ─▶ │ CatalogContextRetriever  │ ─▶ │ Catalog API    │
└──────────────────┘    │  (keyword + scoring)     │    └────────────────┘
        │               └──────────────────────────┘
        ▼
┌──────────────────┐    ┌──────────────────────────┐
│ QueryService     │ ─▶ │ Vercel AI SDK            │
│  (build prompt)  │    │  generateText({ system,  │
└──────────────────┘    │    prompt, model: ... }) │
                        └──────────────────────────┘
```

The LLM call uses `@ai-sdk/anthropic` + `ai`'s `generateText`, deliberately
matching the surface area proposed in
[BEP-0015: AI Model Provider Service](https://github.com/backstage/backstage/pull/33906).
When the AI Provider Service lands as a core extension point, replacing
`generateText` with `provider.getLanguageModelFactory()(modelId)` is a small,
contained refactor.

## Why this is the _inverse_ of `mcp-actions-backend`

- `mcp-actions-backend` exposes Backstage's actions as **MCP tools** so
  external AI agents can act on the catalog.
- `catalog-assistant-backend` consumes the catalog **from within Backstage**
  via an LLM call, so a human (or another Backstage plugin) can query it.

Both feed off the same underlying catalog; the audiences are opposite.

## Limitations

- **Stateless multi-turn.** The backend keeps no history; the client sends
  prior turns as `history` on each `POST /v1/query` (capped server-side), and
  recent user turns are folded into retrieval so follow-ups ("who owns it?")
  resolve. There is no server-side persistence — clear/scope is the client's job.
- **Keyword retrieval only.** Compound questions ("services tagged X that
  depend on Y") are answered as well as the LLM can reason over the retrieved
  page; there is no graph traversal at retrieval time.
- **No tool use.** The LLM cannot fetch additional entities mid-answer.
  Once tool-use ships via BEP-0015, the assistant will be able to follow
  relations on demand.
- **No streaming.** v1 returns the full response in one body. SSE / streaming
  will land alongside the chat UI plugin.
