# platformlog-plugins

Source for **`@theplatformlog/*`** npm packages — public npm distribution of
the Backstage AI plugins discussed at
**https://theplatformlog.dev** plus the framework-agnostic
`@theplatformlog/llm-agent-loop` library.

```
packages/
├── llm-agent-loop/                       # Backstage-agnostic agent loop primitive
├── scaffolder-backend-module-mcp/        # MCP scaffolder action — calls any MCP server tool
├── catalog-assistant-backend/            # Grounded LLM Q&A over the Software Catalog
└── template-authoring-backend/           # Generate scaffolder Templates from natural language
```

## Packages

| Package | npm | Source post | Upstream Backstage PR |
|---|---|---|---|
| `@theplatformlog/llm-agent-loop` | [![npm](https://img.shields.io/npm/v/@theplatformlog/llm-agent-loop.svg?style=flat-square)](https://www.npmjs.com/package/@theplatformlog/llm-agent-loop) | [agent-loop](https://theplatformlog.dev/agent-loop) | — *(extracted from `backstage-corp`)* |
| `@theplatformlog/scaffolder-backend-module-mcp` | [![npm](https://img.shields.io/npm/v/@theplatformlog/scaffolder-backend-module-mcp.svg?style=flat-square)](https://www.npmjs.com/package/@theplatformlog/scaffolder-backend-module-mcp) | [mcp-scaffolder-client](https://theplatformlog.dev/mcp-scaffolder-client) | [#34490](https://github.com/backstage/backstage/pull/34490) |
| `@theplatformlog/catalog-assistant-backend` | [![npm](https://img.shields.io/npm/v/@theplatformlog/catalog-assistant-backend.svg?style=flat-square)](https://www.npmjs.com/package/@theplatformlog/catalog-assistant-backend) | [catalog-assistant](https://theplatformlog.dev/catalog-assistant) | [#34491](https://github.com/backstage/backstage/pull/34491) |
| `@theplatformlog/template-authoring-backend` | [![npm](https://img.shields.io/npm/v/@theplatformlog/template-authoring-backend.svg?style=flat-square)](https://www.npmjs.com/package/@theplatformlog/template-authoring-backend) | [template-authoring](https://theplatformlog.dev/template-authoring) | [#34492](https://github.com/backstage/backstage/pull/34492) |

## Why two homes?

The three scaffolder/catalog plugins also live on upstream draft PRs
(`@backstage/plugin-*`). Net-new plugin contributions in Backstage take
months. Publishing under `@theplatformlog/*` makes them installable today
and starts the download counter.

When upstream merges, consumers can swap the package name in their
`package.json` (e.g. `@theplatformlog/scaffolder-backend-module-mcp` →
`@backstage/plugin-scaffolder-backend-module-mcp`); the source and API
shape stays compatible.

`@theplatformlog/llm-agent-loop` is unique to this repo — it's the
Backstage-agnostic extraction of the agent loop primitive used inside
the (private) `backstage-corp` incident-investigation prototype. No
Backstage runtime deps; just zod as a peer.

## Local dev

```bash
yarn install
yarn build           # all packages
yarn test            # all packages
yarn workspace @theplatformlog/llm-agent-loop test  # one package
```

Node 20+ required.

## Publishing

See **[PUBLISH.md](./PUBLISH.md)** for the one-time npm setup and the
per-package `npm publish` workflow.

## Where the source comes from

- The three scaffolder/catalog plugins are kept in sync with the upstream
  fork at [`Naga15/backstage`](https://github.com/Naga15/backstage), branches
  `feat/scaffolder-backend-module-mcp`, `feat/catalog-assistant-backend`,
  `feat/template-authoring-backend`. The Backstage-monorepo build setup
  there uses `backstage-cli package build`; here, plain `tsc`. The src/ is
  identical except for one import in the MCP module (alpha vs main entry
  for `scaffolderActionsExtensionPoint`).
- `llm-agent-loop` is extracted from
  [`Naga15/backstage-corp`](https://github.com/Naga15/backstage-corp)
  (`plugins/incident-copilot-backend/src/agent/` and
  `services/AgentLoop.ts`), with the Backstage-specific bits removed —
  no `EvidenceItem`, no `SuggestedAction`, no Backstage type imports.
  Generic over a user-supplied `TData` payload.

## License

Apache-2.0 © Naga15.
