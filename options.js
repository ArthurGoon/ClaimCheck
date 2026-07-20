const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    model: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  gemini: {
    label: "Gemini",
    model: "gemini-2.0-flash",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    label: "OpenAI",
    model: "gpt-4o-mini",
    docsUrl: "https://platform.openai.com/api-keys",
  },
};

const form = document.getElementById("settings-form");
const input = document.getElementById("api-key");
const providerSelect = document.getElementById("provider");
const hintEl = document.getElementById("provider-hint");
const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle-visibility");

chrome.storage.sync.get(["apiKey", "openaiApiKey", "provider"], (data) => {
  const provider = data.provider || "deepseek";
  providerSelect.value = provider;
  updateHint(provider);

  const key = data.apiKey || data.openaiApiKey;
  if (key) input.value = key;
});

providerSelect.addEventListener("change", () => {
  updateHint(providerSelect.value);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = input.value.trim();
  const provider = providerSelect.value;

  chrome.storage.sync.set({ apiKey: value, provider }, () => {
    statusEl.classList.remove("error");
    statusEl.textContent = value
      ? `Salvo (${PROVIDERS[provider]?.label || provider}). Busca: ClaimCheck Agent.`
      : "API key removida.";
  });
});

toggleBtn.addEventListener("click", () => {
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  toggleBtn.textContent = showing ? "Mostrar" : "Ocultar";
});

function updateHint(providerId) {
  const provider = PROVIDERS[providerId] || PROVIDERS.deepseek;
  hintEl.innerHTML = `O LLM só extrai e verifica. A busca na web (Bing + Wikipedia + leitura de páginas) é do ClaimCheck.<br/>Key para <strong>${provider.model}</strong> em <a href="${provider.docsUrl}" target="_blank" rel="noreferrer">${provider.label}</a>.`;
}
