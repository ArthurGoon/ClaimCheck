const stateEl = document.getElementById("state");
const verifyBtn = document.getElementById("verify-btn");

const VERDICT_LABELS = {
  supported: "Confirmado",
  refuted: "Refutado",
  not_enough_evidence: "Evidência insuficiente",
  error: "Erro",
};

init();

async function init() {
  const settings = await sendMessage({ type: "CLAIMCHECK_GET_SETTINGS" });
  if (!settings?.hasKey) {
    renderNotice({
      title: "API key necessária",
      copy: "Configure o provedor de LLM e a API key nas opções da extensão.",
      link: true,
    });
  }
  verifyBtn.addEventListener("click", onVerify);

  // Progresso real enviado pelo background durante a verificação.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "CLAIMCHECK_PROGRESS") return;
    const label = stateEl.querySelector(".loading-label");
    if (!label) return;
    label.textContent =
      message.step === "extract"
        ? "Extraindo afirmações da página…"
        : `Buscando evidências e verificando (${message.done}/${message.total})…`;
  });
}

function getMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || "article";
}

async function onVerify() {
  verifyBtn.disabled = true;
  renderLoading("Lendo a página…");
  try {
    const result = await sendMessage({ type: "CLAIMCHECK_VERIFY", mode: getMode() });
    if (!result?.ok) {
      renderNotice({
        title: result?.code === "NO_API_KEY" ? "Configuração incompleta" : "Não foi possível verificar",
        copy: result?.error || "Erro desconhecido.",
        error: true,
        link: result?.code === "NO_API_KEY",
      });
      return;
    }
    if (!result.claims?.length) {
      renderNotice({
        title: "Nenhuma afirmação checável",
        copy: "Não encontrei afirmações factuais neste texto. Tente selecionar um trecho mais concreto.",
      });
      return;
    }
    renderResults(result);
  } catch (err) {
    renderNotice({ title: "Erro inesperado", copy: err?.message || "Algo deu errado.", error: true });
  } finally {
    verifyBtn.disabled = false;
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
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
        <span class="pulse-dot"></span><span class="pulse-dot"></span><span class="pulse-dot"></span>
      </div>
    </div>`;
}

function renderNotice({ title, copy, error = false, link = false }) {
  stateEl.innerHTML = `
    <div class="notice ${error ? "error" : ""}">
      <p class="notice-title">${escapeHtml(title)}</p>
      <p class="notice-copy">${escapeHtml(copy)}</p>
      ${link ? `<p class="notice-copy"><a class="settings-link" href="options.html" target="_blank" rel="noreferrer">Abrir configurações</a></p>` : ""}
    </div>`;
}

function renderResults({ claims, meta, warnings }) {
  const metaLine = [
    meta?.title,
    `${claims.length} afirmaç${claims.length === 1 ? "ão" : "ões"}`,
    meta?.model && `${meta.provider} ${meta.model}`,
    meta?.search && `busca: ${meta.search}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const warningBlock = warnings?.length
    ? `<p class="warnings">Algumas buscas falharam: ${escapeHtml(warnings.join("; "))}</p>`
    : "";

  const items = claims.map(renderClaim).join("");
  stateEl.innerHTML = `
    <div class="results">
      <p class="meta">${escapeHtml(metaLine)}</p>
      ${warningBlock}
      <ul class="claims">${items}</ul>
    </div>`;
}

function renderClaim(claim, index) {
  const verdict = VERDICT_LABELS[claim.verdict] ? claim.verdict : "not_enough_evidence";
  const confidence = Math.round((claim.confidence ?? 0) * 100);

  const cited = (claim.citations || [])
    .map(
      (c) => `<li><span class="source-id">${escapeHtml(c.id)}</span><a href="${escapeAttr(c.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
        c.title || c.url
      )}</a><span class="source-domain">${escapeHtml(c.domain || "")}</span></li>`
    )
    .join("");

  const evidence = claim.evidence || [];
  const evidenceList = evidence.length
    ? `<details class="evidence-toggle">
        <summary>Ver as ${evidence.length} evidências consultadas</summary>
        <ul class="evidence-list">
          ${evidence
            .map(
              (e) => `<li><span class="source-id">${escapeHtml(e.id)}</span><a href="${escapeAttr(e.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
                e.title
              )}</a><p>${escapeHtml(truncate(e.text, 280))}</p></li>`
            )
            .join("")}
        </ul>
      </details>`
    : "";

  return `
    <li class="claim" style="animation-delay: ${index * 70}ms">
      <div class="claim-head">
        <span class="verdict ${escapeAttr(verdict)}">${escapeHtml(VERDICT_LABELS[verdict])}</span>
        ${verdict === "error" ? "" : `<span class="confidence">confiança ${confidence}%</span>`}
      </div>
      <p class="claim-text">${escapeHtml(claim.claim)}</p>
      ${claim.explanation ? `<p class="claim-explanation">${escapeHtml(claim.explanation)}</p>` : ""}
      ${cited ? `<ul class="sources">${cited}</ul>` : ""}
      ${evidenceList}
    </li>`;
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  const url = String(value ?? "");
  // Só links http(s) viram href; qualquer outro esquema é neutralizado.
  if (/^[a-z]+:/i.test(url) && !/^https?:/i.test(url)) return "#";
  return escapeHtml(url).replace(/'/g, "&#39;");
}
