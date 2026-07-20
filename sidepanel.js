const stateEl = document.getElementById("state");
const verifyBtn = document.getElementById("verify-btn");

const VERDICT_LABELS = {
  true: "Verdadeiro",
  false: "Falso",
  misleading: "Impreciso",
  unverifiable: "Sem evidência",
};

const LOADING_STEPS = [
  "Entendendo o contexto…",
  "Extraindo claims…",
  "Buscando notícias e fontes…",
  "Lendo páginas…",
  "Verificando com evidências…",
];

init();

async function init() {
  const settings = await sendMessage({ type: "CLAIMCHECK_GET_SETTINGS" });
  if (!settings?.hasKey) {
    renderNotice({
      title: "API key necessária",
      copy: "Configure sua API key nas opções da extensão.",
      error: false,
      link: true,
    });
  }

  verifyBtn.addEventListener("click", onVerify);
}

function getMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked?.value || "article";
}

async function onVerify() {
  verifyBtn.disabled = true;
  let stepIndex = 0;
  renderLoading(LOADING_STEPS[0]);

  const timer = setInterval(() => {
    stepIndex = Math.min(stepIndex + 1, LOADING_STEPS.length - 1);
    const label = stateEl.querySelector(".loading-label");
    if (label) label.textContent = LOADING_STEPS[stepIndex];
  }, 1400);

  try {
    const result = await sendMessage({
      type: "CLAIMCHECK_VERIFY",
      mode: getMode(),
    });

    clearInterval(timer);

    if (!result?.ok) {
      if (result?.code === "NO_API_KEY") {
        renderNotice({
          title: "API key necessária",
          copy: result.error,
          error: true,
          link: true,
        });
      } else {
        renderNotice({
          title: "Não foi possível verificar",
          copy: result?.error || "Erro desconhecido.",
          error: true,
        });
      }
      return;
    }

    if (!result.claims?.length) {
      renderNotice({
        title: "Nenhuma afirmação factual",
        copy: "Não encontramos claims checáveis neste texto. Tente selecionar um trecho mais concreto.",
        error: false,
      });
      return;
    }

    renderResults(result.claims, result.meta);
  } catch (err) {
    clearInterval(timer);
    renderNotice({
      title: "Erro inesperado",
      copy: err?.message || "Algo deu errado.",
      error: true,
    });
  } finally {
    verifyBtn.disabled = false;
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      resolve(response);
    });
  });
}

function renderLoading(label) {
  stateEl.innerHTML = `
    <div class="loading">
      <p class="loading-label">${escapeHtml(label)}</p>
      <div class="pulse-row" aria-hidden="true">
        <span class="pulse-dot"></span>
        <span class="pulse-dot"></span>
        <span class="pulse-dot"></span>
      </div>
    </div>
  `;
}

function renderNotice({ title, copy, error, link }) {
  stateEl.innerHTML = `
    <div class="notice ${error ? "error" : ""}">
      <p class="notice-title">${escapeHtml(title)}</p>
      <p class="notice-copy">${escapeHtml(copy)}</p>
      ${
        link
          ? `<p class="notice-copy"><a class="settings-link" href="options.html" target="_blank" rel="noreferrer">Abrir configurações</a></p>`
          : ""
      }
    </div>
  `;
}

function renderResults(claims, meta) {
  const searchLabel = meta?.searchEngine || "ClaimCheck Agent";
  const sourcesNote =
    meta?.claimsWithSearchResults != null
      ? ` · ${meta.claimsWithSearchResults}/${meta.claimCount || claims.length} com fontes`
      : "";
  const metaLine = meta?.title
    ? `${meta.title} · ${claims.length} claim${claims.length === 1 ? "" : "s"}${sourcesNote} · ${searchLabel}`
    : `${claims.length} claim${claims.length === 1 ? "" : "s"}${sourcesNote} · ${searchLabel}`;

  const items = claims
    .map((claim, index) => {
      const verdict = claim.verdict || "unverifiable";
      const label = VERDICT_LABELS[verdict] || VERDICT_LABELS.unverifiable;
      const confidence = Math.round((claim.confidence ?? 0) * 100);
      const sources = (claim.sources || [])
        .map(
          (s) =>
            `<li><a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
              s.title || s.url
            )}</a></li>`
        )
        .join("");

      return `
        <li class="claim" style="animation-delay: ${index * 70}ms">
          <div class="claim-head">
            <span class="verdict ${escapeAttr(verdict)}">${escapeHtml(label)}</span>
            <span class="confidence">${confidence}%</span>
          </div>
          <p class="claim-text">${escapeHtml(claim.claim)}</p>
          ${
            claim.explanation
              ? `<p class="claim-explanation">${escapeHtml(claim.explanation)}</p>`
              : ""
          }
          ${sources ? `<ul class="sources">${sources}</ul>` : ""}
        </li>
      `;
    })
    .join("");

  stateEl.innerHTML = `
    <div class="results">
      <p class="meta">${escapeHtml(metaLine)}</p>
      <ul class="claims">${items}</ul>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
