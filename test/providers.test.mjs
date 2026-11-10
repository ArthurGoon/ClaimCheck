import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LLM_PROVIDERS,
  SEARCH_PROVIDERS,
  DEFAULT_STORED,
  normalizeStored,
  runtimeSettings,
  guessProviderFromKey,
  resolveModel,
} from "../lib/providers.js";

test("padrão é OpenRouter com só Wikipedia na busca", () => {
  const s = runtimeSettings({});
  assert.equal(s.llmProvider, "openrouter");
  assert.equal(s.searchProvider, "wikipedia");
  assert.equal(s.llmApiKey, "");
  assert.equal(resolveModel(s), LLM_PROVIDERS.openrouter.defaultModel);
});

test("cada provedor tem modelo padrão na própria lista curta", () => {
  for (const p of Object.values(LLM_PROVIDERS)) {
    assert.ok(p.models.some((m) => m.id === p.defaultModel), `${p.id}: padrão fora da lista`);
    assert.match(p.keyUrl, /^https:\/\//);
  }
});

test("adivinha o provedor pelo começo da chave", () => {
  assert.equal(guessProviderFromKey("sk-or-v1-abc"), "openrouter");
  assert.equal(guessProviderFromKey("sk-ant-api03-abc"), "anthropic");
  assert.equal(guessProviderFromKey("sk-proj-abc"), "openai");
  assert.equal(guessProviderFromKey("AIzaSyabc"), "gemini");
  assert.equal(guessProviderFromKey("qualquer"), "");
  assert.equal(guessProviderFromKey(""), "");
});

test("guarda uma chave e um modelo por provedor", () => {
  const stored = {
    llmProvider: "anthropic",
    llmKeys: { openrouter: "sk-or-1", anthropic: " sk-ant-2 " },
    llmModels: { anthropic: "claude-sonnet-5-5" },
    searchProvider: "tavily",
    searchKeys: { tavily: "tvly-1" },
  };
  assert.deepEqual(runtimeSettings(stored), {
    llmProvider: "anthropic",
    llmApiKey: "sk-ant-2",
    llmModel: "claude-sonnet-5-5",
    searchProvider: "tavily",
    searchApiKey: "tvly-1",
    maxClaims: DEFAULT_STORED.maxClaims,
  });
  assert.equal(runtimeSettings({ ...stored, llmProvider: "openrouter" }).llmApiKey, "sk-or-1");
});

test("migra o formato da versão anterior (chave solta, DeepSeek e DuckDuckGo removidos)", () => {
  const old = normalizeStored({ llmProvider: "openai", llmApiKey: "sk-x", llmModel: "gpt-x", searchProvider: "duckduckgo", maxClaims: 40 });
  assert.equal(old.llmKeys.openai, "sk-x");
  assert.equal(old.llmModels.openai, "gpt-x");
  assert.equal(old.searchProvider, "wikipedia");
  assert.equal(old.maxClaims, 8);
  assert.equal("llmApiKey" in old, false);

  const removed = normalizeStored({ llmProvider: "deepseek", llmApiKey: "k" });
  assert.equal(removed.llmProvider, "openrouter");
});

test("buscas com chave exigem chave; Wikipedia não", () => {
  assert.equal(SEARCH_PROVIDERS.wikipedia.needsKey, false);
  assert.equal(SEARCH_PROVIDERS.tavily.needsKey, true);
  assert.equal(SEARCH_PROVIDERS.brave.needsKey, true);
});

test("mapas atuais vazios não restauram chaves e modelos legados", () => {
  const s = runtimeSettings({
    llmProvider: "openai",
    llmApiKey: "chave-antiga",
    llmModel: "modelo-antigo",
    searchProvider: "tavily",
    searchApiKey: "busca-antiga",
    llmKeys: {},
    llmModels: {},
    searchKeys: {},
  });
  assert.equal(s.llmApiKey, "");
  assert.equal(s.llmModel, "");
  assert.equal(s.searchApiKey, "");
});
