# Publishing `@theplatformlog/*` to npm

One-time setup, then `npm publish` per package whenever a release is cut.

## One-time setup

### 1. Reserve the npm org (if not done)

If `@theplatformlog` isn't already an org on npm:

1. Log into https://www.npmjs.com.
2. Profile → **Add Organization**.
3. Name: `theplatformlog`. Plan: **Free** (covers public scoped packages).

### 2. Login locally

```bash
npm login   # or: npm login --scope=@theplatformlog
```

Verify:

```bash
npm whoami
npm org ls theplatformlog
```

### 3. Verify the packages

From the monorepo root:

```bash
yarn install
yarn build
yarn test
```

All four packages should build to `dist/` with type declarations and pass
their tests.

## Per-release publish

For each package, in its own directory:

```bash
cd packages/llm-agent-loop
yarn build           # confirms dist/ is fresh
npm publish --access public
```

For the **first publish**:
- `--access public` is required (scoped packages default to restricted).
- The `prepublishOnly` script in each package.json runs `yarn build`
  automatically, but running it manually first surfaces any errors before
  `npm publish` starts uploading.

Order doesn't matter — none of the packages depend on each other on npm.
The three Backstage plugin packages depend on `@backstage/*` packages
(public on npm); `@theplatformlog/llm-agent-loop` has only `zod` as a
peer dep.

### Suggested first-publish order

1. `@theplatformlog/llm-agent-loop` — no Backstage deps; cleanest smoke
   test that the publish flow works.
2. `@theplatformlog/scaffolder-backend-module-mcp` — second simplest.
3. `@theplatformlog/catalog-assistant-backend`
4. `@theplatformlog/template-authoring-backend`

## Bumping versions

For now, manually bump each package's `version` field before
`npm publish`. When/if this grows past 4 packages, adopt `changesets`:

```bash
npm install -D @changesets/cli
npx changeset init
npx changeset            # interactive: pick packages + version bump
npx changeset version    # writes version bumps to package.json
npx changeset publish    # publishes everything that has a changeset
```

## After first publish

- npm download badges in the package READMEs and blog posts at
  theplatformlog.dev start populating within ~24 hours.
- Submit `@theplatformlog/scaffolder-backend-module-mcp`,
  `@theplatformlog/catalog-assistant-backend`, and
  `@theplatformlog/template-authoring-backend` to
  [`backstage/community-plugins`](https://github.com/backstage/community-plugins)
  for marketplace presence.
- Cross-post each blog post's announce on:
  - Backstage Discord (#general or #show-and-tell)
  - CNCF Slack (`#backstage`)
  - Show HN
  - r/devops, r/kubernetes
- Track adoption: download counts (`npm-stat`), GitHub "Used by"
  (auto-tracked), and any named-org install confirmations.

## When upstream Backstage PRs merge

For `@theplatformlog/scaffolder-backend-module-mcp` →
`@backstage/plugin-scaffolder-backend-module-mcp` (and the two siblings):

1. Update the `@theplatformlog/*` package README with a deprecation
   notice pointing at the canonical `@backstage/*` package.
2. Bump the `@theplatformlog/*` version (e.g. to `1.0.0` or `0.9.0` →
   `0.10.0`) and republish with a console-warn on import suggesting the
   switch.
3. Eventually publish a final `*.0.0` that simply re-exports from the
   `@backstage/*` package, so existing imports continue to work.
4. Keep the download counter alive on `@theplatformlog/*` — it's
   evidence regardless of where the code lives.
