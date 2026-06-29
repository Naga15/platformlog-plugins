# Catalog Assistant — Architecture & Model Guide

Catalog-aware, grounded LLM Q&A for Backstage: ask natural-language questions
about the Software Catalog and get answers grounded in catalog entities, with
entity-ref **citations** and a **multi-turn** chat UI. Provider-agnostic, with
first-class **AWS Bedrock** support.

This document covers the architecture, the request flow, and how to choose a
model (with Bedrock pricing). For install/config see the package READMEs:

- Backend: [`packages/catalog-assistant-backend`](../packages/catalog-assistant-backend/README.md)
- Frontend: [`frontend-plugin/catalog-assistant`](../frontend-plugin/catalog-assistant/README.md)

---

## Two packages, one plugin

Backstage requires the browser and Node halves to be separate npm packages; they
share the `catalog-assistant` plugin id.

| Package | Runtime | Responsibility |
|---|---|---|
| `@theplatformlog/catalog-assistant-backend` | Node / Express | Retrieval, prompt assembly, LLM call, HTTP API |
| `@theplatformlog/catalog-assistant` | Browser / React (legacy frontend system) | Floating chat widget + model dropdown + citations |

---

## Architecture

```
 Browser (Backstage app)                         Backend plugin (Node)
┌──────────────────────────┐                ┌───────────────────────────────────┐
│ CatalogAssistantChat      │  POST /query   │ router                            │
│  - prompt box             │ ─────────────▶ │  - httpAuth: authenticate caller  │
│  - model dropdown         │  GET /models   │  - auth: mint catalog token       │
│  - session history        │ ◀───────────── │            (own service identity) │
│  - citations chips        │   {answer,     │                 │                 │
└──────────────────────────┘    citations}  │                 ▼                 │
        client: discoveryApi + fetchApi      │ QueryService                      │
        (Backstage token attached)           │  1. retrieval query =             │
                                             │     recent user turns + question  │
                                             │  2. CatalogContextRetriever ──────┼──▶ Catalog API
                                             │     (keyword/substring scoring)   │    GET /entities
                                             │  3. build grounded prompt         │
                                             │  4. messages = history + grounded │
                                             │     current turn                  │
                                             │            │                      │
                                             │            ▼                      │
                                             │ resolveModel → Vercel AI SDK ─────┼──▶ LLM provider
                                             │  (anthropic|openai|google|        │   (Bedrock / Ollama
                                             │   mistral|bedrock)                │    / Anthropic / …)
                                             │  generateText({system, messages}) │
                                             └───────────────────────────────────┘
```

### Backend components

- **`resolveModel` / `SUPPORTED_PROVIDERS`** (`createModel.ts`) — maps a provider
  key to a Vercel AI SDK factory and dynamically imports only the selected one.
  Providers: `anthropic` (default, bundled), `openai`, `google`, `mistral`,
  `bedrock`. The `openai` provider also targets any OpenAI-compatible endpoint
  via `baseURL` (Ollama, Groq, OpenRouter, vLLM …).
- **`ModelProvider`** — the admin-configured **allowlist**. Lazily resolves and
  caches each allowed model; rejects ids outside the list with `400`. Backs the
  `GET /v1/models` dropdown and the per-request `model` override.
- **`CatalogContextRetriever`** — deterministic keyword / substring scoring over
  `metadata.name` (weight 4), `title` (3), `description` (2), `tags` (2),
  `kind` (1), `spec.type` (1). **No embedding store** — intentionally simple and
  swappable for semantic retrieval behind the same interface later.
- **`QueryService`** — retrieval-augmented and **multi-turn**: folds recent user
  turns into the retrieval query (so "who owns *it*?" resolves), threads prior
  turns before the grounded current turn, and returns the answer plus the
  retrieved entity refs as citations. Stateless — the client owns history.
- **`router`** — `GET /v1/models`, `POST /v1/query` (`question`, optional
  `model`, optional `history`). Authenticates the caller via `httpAuth`, then
  reads the catalog using the plugin's **own service token**
  (`getPluginRequestToken(onBehalfOf: getOwnServiceCredentials())`).

### Frontend components

- **API client** — `discoveryApi` + `fetchApi` (the Backstage token is attached
  automatically); calls `GET /v1/models` and `POST /v1/query`.
- **`CatalogAssistantChat`** — floating bottom-right widget (mount once in
  `Root.tsx`; register the plugin in `createApp({ plugins: [...] })`). Keeps the
  conversation **per browser session** (`sessionStorage`), sends prior turns,
  renders answers (Markdown) + citation chips, and has a **Clear** button.
- **`CatalogAssistantPage`** — optional standalone page + sidebar item.

### Design choices

- **Grounded, not free-form.** Answers must come from the retrieved entities;
  the system prompt forbids fabricating ownership / dependencies.
- **Stateless backend.** No DB; the client carries conversation history. Clean
  for Backstage and horizontally scalable.
- **Provider-agnostic via the Vercel AI SDK.** Switching LLM is config-only.
- **Cost control by config.** Default to a cheap model; expose a small allowlist;
  disable models after testing without code changes.

---

## Choosing a model (and Bedrock pricing)

The job is **grounded Q&A over a small provided context** — read the entities,
answer, cite. That rewards **instruction-following and grounding discipline**,
not raw world knowledge. So a cheap small model is usually plenty.

### Bedrock has no free tier

Every Bedrock model is billed per token (no local/free option like Ollama). But
for this workload the context is small and answers short, so "cheap" ≈ free in
practice.

### Cost-effective options on Bedrock

| Model | Bedrock model id (base) | $/1M in | $/1M out | Fit for catalog Q&A |
|---|---|---|---|---|
| **Amazon Nova Micro** | `amazon.nova-micro-v1:0` | $0.035 | $0.14 | Cheapest; fine for simple lookups, weaker on complex/nested questions |
| **Amazon Nova Lite** | `amazon.nova-lite-v1:0` | $0.06 | $0.24 | **Recommended default** — strong on structured/grounded tasks, very cheap |
| Mistral Small | `mistral.mistral-small-*` | $0.20 | $0.60 | Fine mid-tier |
| Meta Llama 3.3 70B | `meta.llama3-3-70b-*` | $0.72 | $0.72 | Good reasoning, but pricier than Nova and a notch below Claude on staying grounded |
| **Claude Haiku 4.5** | `*anthropic.claude-haiku-4-5*` | $1 | $5 | **Best quality** of the cheap tier — instruction-following, compound questions, citation fidelity |
| Claude Sonnet 4.6 | `*anthropic.claude-sonnet-4-6*` | $3 | $15 | Overkill for most catalog Q&A |

> Use the exact cross-region **inference profile id** from the Bedrock console
> (e.g. `us.amazon.nova-lite-v1:0`, `us.anthropic.claude-haiku-4-5-v1:0`) after
> enabling Model access. Prices are list per 1M tokens and change — verify in the
> AWS console.

### What the benchmarks say

For this grounded task, ranking is **Haiku 4.5 ≥ Llama 3.3 70B ≥ Nova Lite >
Nova Micro**:

- Claude leads on instruction-following / grounding (won't drift off the
  provided entities).
- In document-extraction style tests: Claude Haiku ~89% vs Nova Micro ~76% on
  complex nested fields; Nova Lite ~97% at the lowest cost.
- Llama 3.3 70B has strong reasoning but costs ~12× Nova Lite's input and is a
  notch below Claude on staying strictly grounded.

### Cost in practice

A typical query (~2K grounded input + ~300 output tokens):

| Model | ~ $/query | ~ queries / $1 |
|---|---|---|
| Nova Micro | $0.0001 | ~10,000 |
| Nova Lite | $0.0002 | ~5,000 |
| Claude Haiku 4.5 | $0.0035 | ~285 |

### Recommendation

- **Default: Amazon Nova Lite** — best value; handles most catalog Q&A.
- **Quality escalation: Claude Haiku 4.5** — for hard/compound questions and
  tight citation requirements. Expose both in the dropdown; let users opt up.
- **Skip Llama 3.3 70B** for this task unless you specifically want a
  non-Anthropic mid-tier.
- Levers: **prompt caching** (~90% off repeated context — the system prompt is
  fixed); skip **Batch** (50% off but async — wrong fit for interactive Q&A).

Sources: AWS Bedrock pricing; Artificial Analysis; Vellum LLM Leaderboard;
Amazon Nova technical report.

---

## Deployment

### Production — AWS Bedrock with an IAM role (recommended)

No static keys; the pod assumes a role via **IRSA / EKS Pod Identity**. Install
`@ai-sdk/amazon-bedrock` + `@aws-sdk/credential-providers` in the backend, then:

```yaml
catalogAssistant:
  provider: bedrock
  awsRegion: us-east-1
  model: us.amazon.nova-lite-v1:0
  models:
    - { id: us.amazon.nova-lite-v1:0, label: Nova Lite (cheap, default) }
    - { id: us.anthropic.claude-haiku-4-5-v1:0, label: Claude Haiku 4.5 (quality) }
```

Attach an IAM role with `bedrock:InvokeModel` (+ `…WithResponseStream`) on the
model and inference-profile ARNs to the backend ServiceAccount. See the backend
README for the IRSA details.

### Bedrock with an API key (bearer token) — for quick testing

Set `apiKey` to a Bedrock API key (or export `AWS_BEARER_TOKEN_BEDROCK`). Short
-lived (~12 h) — handy to validate without IAM:

```yaml
catalogAssistant:
  provider: bedrock
  awsRegion: us-east-1
  apiKey: ${AWS_BEARER_TOKEN_BEDROCK}
  model: us.anthropic.claude-haiku-4-5-v1:0
```

### Local — Ollama (free, no AWS)

Validate the whole flow at $0 with `provider: openai` + an Ollama `baseURL`:

```yaml
catalogAssistant:
  provider: openai
  baseURL: http://localhost:11434/v1
  apiKey: ollama
  model: gemma3:4b
  models:
    - { id: gemma3:4b, label: Gemma 3 4B (local) }
    - { id: llama3.1:8b, label: Llama 3.1 8B (local) }
```

Switching local → Bedrock is **config-only**; no code changes.

---

## Verified behavior

Confirmed end-to-end in a legacy Backstage app against Ollama `gemma3:4b`:

- `GET /v1/models` returns the allowlist + default.
- Grounded `/v1/query` returns answers with correct entity-ref citations.
- Multi-turn: "who owns *it*?" resolves to the entity from the prior turn.
- Per-request model override switches models; a disallowed model returns `400`.
- Catalog reads authenticate via the plugin's own service token.
