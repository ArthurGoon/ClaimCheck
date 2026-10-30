import { LLM_PROVIDERS, SEARCH_PROVIDERS, DEFAULT_SETTINGS } from "./lib/providers.js";

const $ = (id) => document.getElementById(id);
const form = $("settings-form");
const llmProvider = $("llm-provider");
const llmKey = $("llm-key");
const llmModel = $("llm-model");
const llmHint = $("llm-hint");
const searchProvider = $("search-provider");
const searchKey = $("search-key");
const searchKeyRow = $("search-key-row");
const searchHint = $("search-hint");
const maxClaims = $("max-claims");
const statusEl = $("status");
const toggleBtn = $("toggle-visibility");

for (const p of Object.values(LLM_PROVIDERS)) llmProvider.append(new Option(p.label, p.id));
for (const p of Object.values(SEARCH_PROVIDERS)) searchProvider.append(new Option(p.label, p.id));

init();

async function init() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const s = { ...DEFAULT_SETTINGS, ...stored };
  llmProvider.value = LLM_PROVIDERS[s.llmProvider] ? s.llmProvider : DEFAULT_SETTINGS.llmProvider;
  llmKey.value = s.llmApiKey;
  llmModel.value = s.llmModel;
  searchProvider.value = SEARCH_PROVIDERS[s.searchProvider] ? s.searchProvider : DEFAULT_SETTINGS.searchProvider;
  searchKey.value = s.searchApiKey;
  maxClaims.value = s.maxClaims;
  updateHints();
}

llmProvider.addEventListener("change", updateHints);
searchProvider.addEventListener("change", updateHints);

function updateHints() {
  const llm = LLM_PROVIDERS[llmProvider.value];
  llmModel.placeholder = `padrão: ${llm.defaultModel}`;
  llmHint.replaceChildren(
    `Deixe o modelo vazio para usar o padrão (${llm.defaultModel}). Chave em `,
    link(llm.keyUrl, llm.label),
    "."
  );

  const search = SEARCH_PROVIDERS[searchProvider.value];
  searchKeyRow.hidden = !search.needsKey;
  const parts = [search.note || ""];
  if (search.keyUrl) parts.push(" Chave em ", link(search.keyUrl, search.label), ".");
  searchHint.replaceChildren(...parts);
}

function link(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = text;
  return a;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const search = SEARCH_PROVIDERS[searchProvider.value];
  const settings = {
    llmProvider: llmProvider.value,
    llmApiKey: llmKey.value.trim(),
    llmModel: llmModel.value.trim(),
    searchProvider: searchProvider.value,
    searchApiKey: searchKey.value.trim(),
    maxClaims: Math.min(8, Math.max(1, parseInt(maxClaims.value, 10) || DEFAULT_SETTINGS.maxClaims)),
  };

  if (search.needsKey && !settings.searchApiKey) {
    showStatus(`${search.label} precisa de uma API key.`, true);
    return;
  }
  await chrome.storage.local.set(settings);
  maxClaims.value = settings.maxClaims;
  showStatus(settings.llmApiKey ? `Salvo: ${LLM_PROVIDERS[settings.llmProvider].label} + ${search.label}.` : "Salvo, mas sem API key do LLM.", !settings.llmApiKey);
});

toggleBtn.addEventListener("click", () => {
  const show = llmKey.type === "password";
  llmKey.type = searchKey.type = show ? "text" : "password";
  toggleBtn.textContent = show ? "Ocultar chaves" : "Mostrar chaves";
});

function showStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}
