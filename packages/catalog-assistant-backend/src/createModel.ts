/*
 * Copyright 2026 The Backstage Authors
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
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Maps a provider key to the Vercel AI SDK package that supplies it and the
 * factory function that package exports. Any provider whose package exposes a
 * `create<Name>(opts)(modelId)` factory works with this resolver.
 *
 * `@ai-sdk/anthropic` is a hard dependency (the default). The others are
 * declared as optional peer dependencies — install the one you need.
 *
 * @public
 */
export const SUPPORTED_PROVIDERS: Record<
  string,
  { pkg: string; factory: string }
> = {
  anthropic: { pkg: '@ai-sdk/anthropic', factory: 'createAnthropic' },
  openai: { pkg: '@ai-sdk/openai', factory: 'createOpenAI' },
  google: { pkg: '@ai-sdk/google', factory: 'createGoogleGenerativeAI' },
  mistral: { pkg: '@ai-sdk/mistral', factory: 'createMistral' },
  bedrock: { pkg: '@ai-sdk/amazon-bedrock', factory: 'createAmazonBedrock' },
};

/**
 * @public
 */
export interface ResolveModelOptions {
  /**
   * Provider key, e.g. `anthropic` (default), `openai`, `google`, `mistral`,
   * `bedrock`.
   */
  provider: string;
  /**
   * Provider-specific model id, e.g. `claude-opus-4-8`, `gpt-5`. For the
   * `bedrock` provider this is the Bedrock model id or cross-region inference
   * profile id, e.g. `us.anthropic.claude-opus-4-8-v1:0` (copy the exact value
   * from the Bedrock console → Model catalog after enabling model access).
   */
  modelId: string;
  /**
   * API key. If omitted, the provider's own SDK reads its conventional env var
   * (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
   * `MISTRAL_API_KEY`). Not used by the `bedrock` provider, which authenticates
   * with AWS credentials instead.
   */
  apiKey?: string;
  /**
   * Override the provider's base URL. The main use is pointing the `openai`
   * provider at any OpenAI-API-compatible endpoint to run **free or local
   * models** — e.g. Ollama (`http://localhost:11434/v1`, runs Gemma 3 / Llama
   * locally at $0), Groq, OpenRouter, vLLM, LM Studio, Together. For Ollama,
   * pass any non-empty `apiKey` (e.g. `"ollama"`) — it's ignored by the server
   * but the SDK requires one.
   */
  baseURL?: string;
  /**
   * AWS region for the `bedrock` provider, e.g. `us-east-1`. Required when
   * `provider` is `bedrock`.
   */
  awsRegion?: string;
  /**
   * Explicit AWS access key id for the `bedrock` provider. If omitted (along
   * with the secret key), the AWS default credential chain is used so an IAM
   * role is assumed automatically — EKS IRSA / Pod Identity, EC2/ECS instance
   * roles, SSO, a shared profile, or AWS_* env vars. This requires the
   * `@aws-sdk/credential-providers` package to be installed in the backend.
   * Prefer this (an IAM role, no static keys) in production.
   */
  awsAccessKeyId?: string;
  /** Explicit AWS secret access key for the `bedrock` provider. */
  awsSecretAccessKey?: string;
  /** Optional AWS session token for the `bedrock` provider (temporary creds). */
  awsSessionToken?: string;
}

/**
 * Resolves a provider + model id into a Vercel AI SDK `LanguageModel`,
 * dynamically importing only the provider package that's actually selected.
 *
 * Returns `unknown` deliberately — the services that consume the model treat
 * it opaquely, which keeps this package decoupled from any single AI SDK
 * version's `LanguageModel` type.
 *
 * @public
 */
export async function resolveModel(
  opts: ResolveModelOptions,
): Promise<unknown> {
  const {
    provider,
    modelId,
    apiKey,
    baseURL,
    awsRegion,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsSessionToken,
  } = opts;
  const entry = SUPPORTED_PROVIDERS[provider];
  if (!entry) {
    throw new Error(
      `unknown model provider '${provider}'. Supported: ${Object.keys(
        SUPPORTED_PROVIDERS,
      ).join(', ')}.`,
    );
  }

  let mod: any;
  try {
    // Variable specifier keeps optional providers out of the compile-time
    // module graph; a missing optional package surfaces as a friendly error.
    mod = await import(entry.pkg);
  } catch {
    throw new Error(
      `model provider '${provider}' requires the '${entry.pkg}' package. ` +
        `Install it in your backend: yarn --cwd packages/backend add ${entry.pkg}`,
    );
  }

  const factory = mod[entry.factory] ?? mod.default?.[entry.factory];
  if (typeof factory !== 'function') {
    throw new Error(
      `'${entry.pkg}' does not export '${entry.factory}'; ` +
        `the installed version may be incompatible.`,
    );
  }

  // Bedrock authenticates with AWS credentials + region, not apiKey/baseURL,
  // so it gets its own option shape.
  const factoryOpts: Record<string, unknown> = {};
  if (provider === 'bedrock') {
    if (!awsRegion) {
      throw new Error(
        "catalog-assistant: 'awsRegion' is required for the bedrock provider",
      );
    }
    factoryOpts.region = awsRegion;
    if (apiKey) {
      // Bedrock API key (bearer token) — short-lived, good for testing without
      // IAM creds. The provider also reads AWS_BEARER_TOKEN_BEDROCK from the
      // environment if `apiKey` is omitted.
      factoryOpts.apiKey = apiKey;
    } else if (awsAccessKeyId && awsSecretAccessKey) {
      // Explicit static credentials.
      factoryOpts.accessKeyId = awsAccessKeyId;
      factoryOpts.secretAccessKey = awsSecretAccessKey;
      if (awsSessionToken) factoryOpts.sessionToken = awsSessionToken;
    } else {
      // No static creds: resolve via the AWS default credential chain so the
      // role is assumed automatically — EKS IRSA / Pod Identity, EC2/ECS
      // instance roles, SSO, shared profile, or AWS_* env vars. The bedrock
      // provider does not bundle this resolver, so we supply it from the
      // optional '@aws-sdk/credential-providers' peer dependency.
      try {
        const creds: any = await import('@aws-sdk/credential-providers');
        const fromNodeProviderChain =
          creds.fromNodeProviderChain ?? creds.default?.fromNodeProviderChain;
        if (typeof fromNodeProviderChain === 'function') {
          factoryOpts.credentialProvider = fromNodeProviderChain();
        }
      } catch {
        // Package not installed: fall back to the provider's own env-var
        // handling (static AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or a
        // Bedrock API key via AWS_BEARER_TOKEN_BEDROCK). IRSA / Pod Identity /
        // instance roles require '@aws-sdk/credential-providers' to be
        // installed in the backend.
      }
    }
  } else {
    if (apiKey) factoryOpts.apiKey = apiKey;
    if (baseURL) factoryOpts.baseURL = baseURL;
  }

  const instance = factory(factoryOpts) as any;
  // OpenAI-compatible endpoints (Ollama, Groq, OpenRouter, AWS Bedrock's
  // OpenAI-compatible "Mantle" endpoint, …) universally speak Chat Completions.
  // `@ai-sdk/openai` v2 defaults the callable to the Responses API, which many
  // of those reject (e.g. Claude on Bedrock Mantle: "does not support the
  // '/v1/responses' API"). Force Chat Completions for the openai provider.
  if (provider === 'openai' && typeof instance.chat === 'function') {
    return instance.chat(modelId);
  }
  return instance(modelId);
}
