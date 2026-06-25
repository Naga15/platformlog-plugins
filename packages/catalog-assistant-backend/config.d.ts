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

export interface Config {
  catalogAssistant?: {
    /**
     * LLM provider to use. One of: "anthropic" (default), "openai",
     * "google", "mistral". Non-default providers require the matching
     * `@ai-sdk/<provider>` package to be installed in the backend.
     */
    provider?: string;
    /**
     * Model id to use for question answering, passed through to the
     * selected provider (e.g. "claude-opus-4-8", "gpt-5",
     * "gemini-2.5-pro"). Defaults to "claude-opus-4-8" for the anthropic
     * provider; required for any other provider.
     */
    model?: string;
    /**
     * API key for the selected provider. If omitted, the provider SDK reads
     * its conventional env var (ANTHROPIC_API_KEY, OPENAI_API_KEY,
     * GOOGLE_GENERATIVE_AI_API_KEY, MISTRAL_API_KEY).
     * @visibility secret
     */
    apiKey?: string;
    /**
     * Override the provider base URL. Use with provider "openai" to point at
     * any OpenAI-API-compatible endpoint and run free or local models:
     * Ollama ("http://localhost:11434/v1", runs Gemma 3 locally at no cost),
     * Groq, OpenRouter, vLLM, LM Studio, Together. For Ollama, set apiKey to
     * any non-empty value (e.g. "ollama").
     */
    baseURL?: string;
    /**
     * Deprecated alias for `apiKey`, kept for backwards compatibility.
     * @visibility secret
     */
    anthropicApiKey?: string;
    /**
     * Maximum number of catalog entities to include in the LLM context.
     * Defaults to 20.
     */
    maxContextEntities?: number;
    /**
     * Maximum output tokens for the LLM response.
     * Defaults to 1024.
     */
    maxOutputTokens?: number;
  };
}
