import {
  LLM_PROVIDERS,
  SEARCH_PROVIDERS,
  MAX_CLAIMS_OPTIONS,
  STORAGE_KEYS,
  normalizeStored,
  runtimeSettings,
  guessProviderFromKey,
  getLlmProvider,
  resolveModel,
  providerName,
} from "./lib/providers.js";

const view = document.getElementById("view");
const settingsBtn = document.getElementById("settings-btn");
const toastEl = document.getElementById("toast");

const VERDICTS = {
  supported: { label: "Confirmada", plural: "confirmadas" },
  refuted: { label: "Refutada", plural: "refutadas" },
  not_enough_evidence: { label: "Inconclusiva", plural: "inconclusivas" },
  error: { label: "Erro", plural: "com erro" },
};

const ERROR_TITLES = {
  NO_KEY: "Falta configurar",
  BAD_KEY: "Chave recusada",
  NO_CREDITS: "Sem créditos",
  BAD_MODEL: "Modelo não encontrado",
  RATE_LIMIT: "Limite de uso atingido",
  NETWORK: "Sem conexão com o provedor",
  BAD_OUTPUT: "Resposta fora do formato",
  NO_SELECTION: "Nada selecionado",
  NO_TEXT: "Pouco texto",
  UNSUPPORTED_PAGE: "Página não suportada",
};
const SETTINGS_ERRORS = new Set(["NO_KEY", "BAD_KEY", "NO_CREDITS", "BAD_MODEL", "BAD_OUTPUT"]);

// Para testes: ?tab=123 fixa a aba analisada (o painel aberto como aba comum não tem "aba ao lado").
const pinnedTabId = Number(new URLSearchParams(location.search).get("tab")) || null;

const state = {
  stored: null,
  devMock: false,
  screen: "home", // home | setup
  mode: "article",
  tab: null,
  run: null, // { tabId, step, page, claims: [], results: [], startedAt }
  report: null,
  reportFilter: "all",
  error: null,
  port: null,
};

init();

async function init() {
  await loadStored();
  settingsBtn.addEventListener("click", () => (state.screen === "setup" ? closeSetup() : openSetup()));
  view.addEventListener("keydown", (event) => {
    const group = event.target.closest('[role="radiogroup"]');
    if (!group || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const options = [...group.querySelectorAll('[role="radio"]:not(:disabled)')];
    const current = options.indexOf(event.target);
    if (current < 0 || !options.length) return;
    event.preventDefault();
    const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
    const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + direction + options.length) % options.length;
    options[index].click();
    options[index].focus();
  });
  await refreshTab();
  if (!hasKey()) state.screen = "setup";
  render();

  if (!pinnedTabId) {
    chrome.tabs.onActivated.addListener(({ windowId }) => onTabChange(windowId));
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (tabId === state.tab?.id && (info.status === "complete" || info.title)) onTabChange();
    });
  }
}

async function loadStored() {
  const raw = await chrome.storage.local.get([...STORAGE_KEYS, "claimcheckDevMock"]);
  state.devMock = Boolean(raw.claimcheckDevMock);
  state.stored = normalizeStored(raw);
}

function hasKey() {
  return state.devMock || Boolean(runtimeSettings(state.stored).llmApiKey);
}

async function refreshTab() {
  if (pinnedTabId) {
    state.tab = await chrome.tabs.get(pinnedTabId).catch(() => null);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;
  }
  if (!state.run && state.tab) {
    const key = `report:${state.tab.id}`;
    const saved = (await chrome.storage.session.get(key).catch(() => ({})))[key];
    state.report = saved && samePage(saved.url, state.tab.url) ? saved : null;
    state.error = null;
  }
}

async function onTabChange(windowId) {
  if (windowId != null) {
    const current = await chrome.windows.getCurrent().catch(() => null);
    if (current && current.id !== windowId) return;
  }
  const previousId = state.tab?.id;
  const previousUrl = state.tab?.url;
  await refreshTab();
  if (state.screen !== "home") return;
  if (state.run) {
    renderPageCard();
    return;
  }
  if (state.tab?.id !== previousId || !samePage(state.tab?.url, previousUrl)) render();
  else renderPageCard();
}

/* ------------------------------------------------------------------ render */

function render() {
  settingsBtn.hidden = !hasKey() && state.screen === "setup";
  settingsBtn.classList.toggle("active", state.screen === "setup");
  if (state.screen === "setup") return renderSetup({ onboarding: !hasKey() });
  renderHome();
}

function renderHome() {
  const running = Boolean(state.run);
  view.innerHTML = `
    ${!running && !state.report && !state.error ? `<div class="home-intro"><p class="eyebrow">UM OLHAR A MAIS</p><h1>Leia com mais contexto.</h1><p>De uma afirmação às fontes que ajudam a entendê-la.</p></div>` : ""}
    <section class="page-card" id="page-card"></section>
    <div class="controls">
      <div class="segmented" role="radiogroup" aria-label="O que verificar">
        ${segment("article", "Página inteira")}
        ${segment("selection", "Só a seleção")}
      </div>
      <p class="mode-help" id="mode-help">${state.mode === "selection" ? "Selecione o texto na página antes de verificar." : "Encontra os principais fatos no texto desta página."}</p>
      <button id="verify-btn" class="btn ${running || state.report ? "secondary" : "primary"} block" type="button">
        ${running ? "Cancelar" : state.report ? "Verificar de novo" : "Verificar"}
      </button>
    </div>
    <section id="output" class="output"></section>`;

  renderPageCard();
  view.querySelectorAll("[data-mode]").forEach((el) =>
    el.addEventListener("click", () => {
      if (state.run) return;
      state.mode = el.dataset.mode;
      view.querySelector("#mode-help").textContent = state.mode === "selection" ? "Selecione o texto na página antes de verificar." : "Encontra os principais fatos no texto desta página.";
      view.querySelectorAll("[data-mode]").forEach((s) => s.setAttribute("aria-checked", String(s.dataset.mode === state.mode)));
    })
  );
  view.querySelector("#verify-btn").addEventListener("click", () => (state.run ? cancelRun() : startRun()));
  renderOutput();
}

function segment(mode, label) {
  return `<button type="button" class="segment" role="radio" data-mode="${mode}" aria-checked="${state.mode === mode}" ${
    state.run ? "disabled" : ""
  }>${label}</button>`;
}

function renderPageCard() {
  const card = view.querySelector("#page-card");
  if (!card) return;
  const tab = state.run ? { title: state.run.page?.title || state.tab?.title, url: state.run.url } : state.tab;
  const url = tab?.url || "";
  const domain = domainOf(url);
  const supported = /^https?:/i.test(url);
  card.innerHTML = `
    ${avatar(domain || "?")}
    <div class="page-text">
      <p class="page-title" title="${attr(tab?.title || "")}">${escapeHtml(tab?.title || "Nenhuma página aberta")}</p>
      <p class="page-domain">${escapeHtml(supported ? domain : "Página interna do navegador")}</p>
    </div>`;
}

function renderOutput() {
  const out = view.querySelector("#output");
  if (!out) return;
  const opened = [...out.querySelectorAll('[data-toggle][aria-expanded="true"]')].map((b) => b.dataset.toggle);
  renderOutputContent(out);
  for (const i of opened) {
    const btn = out.querySelector(`[data-toggle="${i}"]`);
    if (btn?.getAttribute("aria-expanded") === "false") btn.click();
  }
}

function renderOutputContent(out) {
  if (state.run) return renderRun(out);
  if (state.error) return renderError(out, state.error);
  if (state.report) return renderReport(out, state.report);
  out.innerHTML = `
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48"><rect x="9" y="7" width="30" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M16 17h16M16 24h16M16 31h9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="35" cy="34" r="8" fill="var(--brand)"/><path d="M31.5 34.2l2.4 2.4 4.6-4.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <p class="empty-title">Uma leitura, mais perspectiva.</p>
      <p class="empty-copy">Veja o que tem respaldo, o que diverge das fontes e o que ainda precisa de evidência.</p>
      <div class="outcome-guide"><span><i class="guide-dot supported"></i>Confirmada</span><span><i class="guide-dot refuted"></i>Refutada</span><span><i class="guide-dot uncertain"></i>Inconclusiva</span></div>
    </div>
    ${footer()}`;
}

/* ------------------------------------------------------------- verificação */

function startRun() {
  if (!hasKey()) return openSetup();
  const tabId = state.tab?.id;
  if (!tabId) return showToast("Nenhuma aba ativa.");

  state.report = null;
  state.reportFilter = "all";
  state.error = null;
  state.run = { tabId, url: state.tab.url, step: "read", page: null, claims: null, results: [], stages: {}, startedAt: Date.now() };
  renderHome();

  const port = chrome.runtime.connect({ name: "claimcheck-run" });
  state.port = port;
  const keepAlive = setInterval(() => port.postMessage({ type: "ping" }), 20_000);
  port.onDisconnect.addListener(() => {
    clearInterval(keepAlive);
    if (state.port === port && state.run) {
      finishRun({ error: { message: "A verificação foi interrompida. Tente de novo.", code: "" } });
    }
  });
  port.onMessage.addListener((msg) => {
    if (state.port !== port) return;
    if (msg.type === "progress") onProgress(msg);
    if (msg.type === "done") finishRun({ report: msg.report });
    if (msg.type === "error") finishRun({ error: { message: msg.error, code: msg.code } });
  });
  port.postMessage({ type: "start", tabId, mode: state.mode });
}

function cancelRun() {
  const port = state.port;
  state.port = null;
  state.run = null;
  port?.disconnect();
  showToast("Verificação cancelada.");
  renderHome();
}

function finishRun({ report, error }) {
  const port = state.port;
  state.port = null;
  state.run = null;
  port?.disconnect();
  state.report = report || null;
  state.reportFilter = "all";
  state.error = error || null;
  renderHome();
}

function onProgress(msg) {
  const run = state.run;
  if (!run) return;
  if (msg.step === "page") {
    run.page = { title: msg.title, chars: msg.chars, totalChars: msg.totalChars, truncated: msg.truncated };
    run.step = "extract";
    renderPageCard();
  } else if (msg.step === "extract") {
    run.step = "extract";
  } else if (msg.step === "claims") {
    run.claims = msg.claims;
    run.step = "verify";
  } else if (msg.step === "claim") {
    run.stages[msg.index] = msg.stage;
  } else if (msg.step === "result") {
    run.results[msg.index] = msg.result;
  }
  renderOutput();
}

function renderRun(out) {
  const run = state.run;
  const total = run.claims?.length ?? 0;
  const done = run.results.filter(Boolean).length;
  const steps = [
    { key: "read", label: "Lendo a página", detail: run.page ? `${run.page.chars.toLocaleString("pt-BR")} caracteres${run.page.truncated ? " · leitura parcial" : ""}` : "" },
    { key: "extract", label: "Encontrando afirmações", detail: run.claims ? plural(total, "afirmação", "afirmações") : "" },
    { key: "verify", label: "Buscando fontes e avaliando", detail: run.claims ? `${done} de ${total}` : "" },
  ];
  const order = ["read", "extract", "verify"];
  const current = order.indexOf(run.step);

  const stepper = steps
    .map((s, i) => {
      const status = i < current || (s.key === "verify" && total > 0 && done === total) ? "done" : i === current ? "active" : "todo";
      return `<li class="step ${status}"><span class="step-dot" aria-hidden="true"></span><span class="step-label">${s.label}</span>${
        s.detail ? `<span class="step-detail">${escapeHtml(s.detail)}</span>` : ""
      }</li>`;
    })
    .join("");

  let stepperEl = out.querySelector(".stepper");
  let list = out.querySelector(".claims");
  if (!stepperEl) {
    out.innerHTML = `<div class="run-intro"><p class="eyebrow">CONSULTANDO AS FONTES</p><h2>Cada afirmação, um olhar atento.</h2><p>Os resultados aparecem assim que ficam prontos.</p></div><div class="run-progress" aria-label="Afirmações verificadas"><i></i></div><ol class="stepper"></ol><div class="claims"></div>`;
    stepperEl = out.querySelector(".stepper");
    list = out.querySelector(".claims");
  }
  stepperEl.innerHTML = stepper;
  const meter = out.querySelector(".run-progress");
  meter.classList.toggle("indeterminate", !total);
  meter.querySelector("i").style.width = total ? `${done / total * 100}%` : "30%";
  if (total) { meter.setAttribute("role", "progressbar"); meter.setAttribute("aria-valuenow", done); meter.setAttribute("aria-valuemax", total); }

  // Atualiza só os cartões que mudaram, para não piscar nem fechar o que estiver aberto.
  (run.claims || []).forEach((claim, i) => {
    const result = run.results[i];
    const stage = run.stages[i] || "queue";
    const key = result ? "done" : stage;
    let node = list.querySelector(`[data-idx="${i}"]`);
    if (node?.dataset.key === key) return;
    const html = result
      ? claimCard(result, i, { tabId: run.tabId, fresh: true })
      : `<article class="claim pending">
          <div class="claim-top"><span class="chip pending"><span class="spinner" aria-hidden="true"></span>${
            stage === "judge" ? "Avaliando as fontes…" : stage === "search" ? "Buscando fontes…" : "Na fila"
          }</span></div>
          <p class="claim-text">${escapeHtml(claim.text)}</p>
          <div class="skeleton"></div><div class="skeleton short"></div>
        </article>`;
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    const fresh = tpl.content.firstElementChild;
    fresh.dataset.idx = String(i);
    fresh.dataset.key = key;
    if (node) node.replaceWith(fresh);
    else list.append(fresh);
    if (result) bindClaimCards(fresh, { tabId: run.tabId });
  });
}

/* ---------------------------------------------------------------- resultado */

function renderReport(out, report) {
  const claims = report.claims || [];
  const coverage = report.meta?.truncated
    ? `<details class="banner coverage-banner"><summary>Leitura parcial <span>· ${Number(report.meta.charCount).toLocaleString("pt-BR")} de ${Number(report.meta.totalChars).toLocaleString("pt-BR")} caracteres</span></summary><p>Foi analisado o começo do texto extraído. Para conferir outra parte, selecione um trecho na página e use <b>Só a seleção</b>.</p></details>`
    : "";
  if (!claims.length) {
    out.innerHTML = `
      ${coverage}
      <div class="empty">
        <p class="empty-title">Nenhuma afirmação checável</p>
        <p class="empty-copy">Não encontrei fatos verificáveis ${report.mode === "selection" ? "no trecho selecionado" : "nesta página"}. Opiniões, previsões e textos muito curtos ficam de fora.</p>
      </div>
      ${footer(report)}`;
    return;
  }

  const counts = {};
  for (const c of claims) counts[c.verdict] = (counts[c.verdict] || 0) + 1;
  const summary = ["supported", "refuted", "not_enough_evidence", "error"]
    .filter((v) => counts[v])
    .map((v) => `<button type="button" class="count ${v}" data-filter="${v}" aria-pressed="${state.reportFilter === v}"><span class="dot"></span>${counts[v]} ${counts[v] === 1 ? VERDICTS[v].label.toLowerCase() : VERDICTS[v].plural}</button>`)
    .join("");

  const warnings = report.warnings?.length
    ? `<div class="banner"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v5M10 14h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><div><p>Parte da busca falhou e o resultado usa só as fontes que responderam.</p><p class="banner-detail">${escapeHtml(
        report.warnings.join(" · ")
      )}</p></div></div>`
    : "";

  const wikiOnly = report.meta?.searchProvider === "wikipedia";
  const sourceCount = new Set(claims.flatMap((c) => (c.citations || []).map((s) => s.url))).size;
  out.innerHTML = `
    <div class="summary">
      <p class="eyebrow">O QUE AS FONTES DIZEM</p>
      <h1 class="summary-title">${plural(claims.length, "afirmação verificada", "afirmações verificadas")}</h1>
      <p class="summary-meta">${plural(sourceCount, "fonte citada", "fontes citadas")} · Confira os detalhes antes de concluir.</p>
    </div>
    ${coverage}
    ${warnings}
    <div class="counts" role="group" aria-label="Filtrar afirmações"><button type="button" class="count all" data-filter="all" aria-pressed="${state.reportFilter === "all"}">Todas <span>${claims.length}</span></button>${summary}</div>
    <div class="claims">${claims.map((c, i) => state.reportFilter === "all" || state.reportFilter === c.verdict ? claimCard(c, i, { tabId: report.tabId }) : "").join("")}</div>
    ${
      wikiOnly && claims.some((c) => c.verdict === "not_enough_evidence")
        ? `<p class="tip">Fatos recentes costumam ficar fora da Wikipedia. Com uma chave da Tavily ou do Brave a busca cobre a web aberta. <button type="button" class="link" data-open-settings>Configurar busca</button></p>`
        : ""
    }
    ${footer(report)}`;
  bindClaimCards(out, { tabId: report.tabId });
  out.querySelectorAll("[data-filter]").forEach((btn) => btn.addEventListener("click", () => {
    state.reportFilter = btn.dataset.filter;
    renderOutput();
    out.querySelector(`[data-filter="${state.reportFilter}"]`)?.focus({ preventScroll: true });
  }));
  out.querySelector("[data-open-settings]")?.addEventListener("click", openSetup);
}

function claimCard(c, index, { tabId, fresh = false }) {
  const verdict = VERDICTS[c.verdict] ? c.verdict : "not_enough_evidence";
  const confidence = Math.round((c.confidence ?? 0) * 100);
  const evidence = c.evidence || [];
  const cited = new Set((c.citations || []).map((x) => x.id));
  const showConfidence = verdict !== "error" && !(verdict === "not_enough_evidence" && confidence === 0);

  const sources = (c.citations || [])
    .map(
      (s) => `<a class="source" href="${safeUrl(s.url)}" target="_blank" rel="noreferrer noopener" title="${attr(`${s.title} · ${s.domain}`)}">
        ${avatar(s.domain, "sm")}<span>${escapeHtml(sourceLabel(s))}</span></a>`
    )
    .join("");

  const evidenceList = evidence
    .map(
      (e) => `<li class="evidence-item ${cited.has(e.id) ? "cited" : ""}">
        <a href="${safeUrl(e.url)}" target="_blank" rel="noreferrer noopener" class="evidence-head">
          ${avatar(e.domain, "sm")}
          <span class="evidence-title">${escapeHtml(cleanTitle(e.title))}</span>
          ${cited.has(e.id) ? `<span class="badge">citada</span>` : ""}
        </a>
        <p class="evidence-domain">${escapeHtml(e.domain)}</p>
        <p class="evidence-text">${escapeHtml(truncate(e.text, 320))}</p>
      </li>`
    )
    .join("");

  return `
    <article class="claim ${verdict}${fresh ? " fresh" : ""}">
      <div class="claim-top">
        <span class="claim-label"><span class="claim-index">${String(index + 1).padStart(2, "0")}</span><span class="chip ${verdict}"><span class="dot"></span>${VERDICTS[verdict].label}</span></span>
        ${
          showConfidence
            ? `<span class="confidence" title="Confiança declarada pelo modelo, sem calibração">Modelo: ${confidence}%</span>`
            : ""
        }
      </div>
      <p class="claim-text">${escapeHtml(c.claim)}</p>
      ${c.explanation ? `<p class="claim-why">${escapeHtml(c.explanation)}</p>` : ""}
      ${sources ? `<div class="sources">${sources}</div>` : ""}
      <div class="claim-actions">
        ${tabId ? `<button type="button" class="link" data-locate="${index}">Mostrar na página</button>` : ""}
        ${
          evidence.length
            ? `<button type="button" class="link" data-toggle="${index}" aria-expanded="false">${plural(evidence.length, "fonte consultada", "fontes consultadas")}</button>`
            : ""
        }
      </div>
      ${evidence.length ? `<ul class="evidence" id="evidence-${index}" hidden>${evidenceList}</ul>` : ""}
    </article>`;
}

function bindClaimCards(root, { tabId }) {
  const source = () => state.run?.results || state.report?.claims || [];
  root.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const list = root.querySelector(`#evidence-${btn.dataset.toggle}`);
      const open = list.hidden;
      list.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    })
  );
  root.querySelectorAll("[data-locate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const claim = source()[Number(btn.dataset.locate)];
      if (!claim) return;
      const res = await sendMessage({ type: "CLAIMCHECK_HIGHLIGHT", tabId, quote: claim.quote, text: claim.claim });
      if (!res?.found) showToast("Não achei esse trecho na página.");
    })
  );
}

function footer(report) {
  const meta = report?.meta;
  let line;
  if (meta) {
    line = `${escapeHtml(meta.model)} via ${escapeHtml(meta.provider)} · ${escapeHtml(meta.search)}`;
  } else {
    const s = runtimeSettings(state.stored);
    const provider = state.devMock ? "Modelo simulado (teste)" : getLlmProvider(s.llmProvider).label;
    line = `${escapeHtml(state.devMock ? "modelo-simulado" : resolveModel(s))} via ${escapeHtml(provider)} · ${escapeHtml(
      SEARCH_PROVIDERS[s.searchProvider].label
    )}`;
  }
  return `<footer class="foot"><p>Verificação automática. Pode errar: confira as fontes antes de compartilhar.</p><details><summary>Modelo e busca utilizados</summary><p>${line}</p></details></footer>`;
}

function renderError(out, error) {
  const code = error.code || "";
  const title = ERROR_TITLES[code] || "Não deu para verificar";
  const action = SETTINGS_ERRORS.has(code)
    ? `<button type="button" class="btn secondary" data-open-settings>Abrir configurações</button>`
    : code === "NO_SELECTION" || code === "NO_TEXT" || code === "UNSUPPORTED_PAGE"
      ? ""
      : `<button type="button" class="btn secondary" data-retry>Tentar de novo</button>`;
  out.innerHTML = `
    <div class="error-card">
      <div class="error-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v6M12 16.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
      <p class="error-title">${escapeHtml(title)}</p>
      <p class="error-copy">${escapeHtml(error.message)}</p>
      ${action}
    </div>`;
  out.querySelector("[data-open-settings]")?.addEventListener("click", openSetup);
  out.querySelector("[data-retry]")?.addEventListener("click", startRun);
}

/* -------------------------------------------------------------- configuração */

function openSetup() {
  state.screen = "setup";
  render();
}

function closeSetup() {
  state.screen = "home";
  render();
}

function renderSetup({ onboarding }) {
  const draft = structuredClone(state.stored);
  let tested = null; // { ok, text }

  view.innerHTML = `
    <div class="setup">
      ${
        onboarding
          ? `<div class="setup-welcome"><p class="eyebrow">SEU PRIMEIRO PASSO</p><h1>Configure uma vez.<br>Confira quando quiser.</h1><p>Conecte seu modelo para transformar a leitura em uma conversa com as fontes.</p></div>
             <p class="lede privacy-note">Sua chave fica neste navegador e é enviada diretamente ao provedor escolhido.</p>`
          : `<div class="setup-head"><button type="button" class="link back" data-back>← Voltar</button><h1>Configurações</h1></div>`
      }

      <section class="field">
        <p class="field-label"><span class="num">1</span>Provedor do modelo</p>
        <div class="providers" role="radiogroup" aria-label="Provedor do modelo">
          ${Object.values(LLM_PROVIDERS)
            .map(
              (p) => `<button type="button" role="radio" class="provider" data-provider="${p.id}">
                <span class="provider-name">${p.label}${p.id === "openrouter" ? `<span class="badge brand">Recomendado</span>` : ""}</span>
                <span class="provider-blurb">${p.blurb}</span>
              </button>`
            )
            .join("")}
        </div>
      </section>

      <section class="field">
        <label class="field-label" for="key-input"><span class="num">2</span><span id="key-label"></span></label>
        <div class="key-row">
          <input id="key-input" type="password" autocomplete="off" spellcheck="false" />
          <button type="button" class="icon-btn" id="key-eye" title="Mostrar chave" aria-label="Mostrar chave">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
          </button>
        </div>
        <p class="hint" id="key-hint"></p>
      </section>

      <section class="field">
        <label class="field-label" for="model-select"><span class="num">3</span>Modelo</label>
        <select id="model-select"></select>
        <input id="model-custom" type="text" aria-label="Identificador do modelo personalizado" autocomplete="off" spellcheck="false" placeholder="id do modelo, ex.: provedor/modelo" hidden />
        <p class="hint" id="model-hint"></p>
      </section>

      <div class="test-row">
        <button type="button" class="btn secondary" id="test-btn">Testar conexão</button>
        <p class="test-status" id="test-status" role="status"></p>
      </div>

      ${
        onboarding
          ? ""
          : `
      <section class="field">
        <p class="field-label">Busca de fontes</p>
        <div class="search-options" role="radiogroup" aria-label="Busca de fontes">
          ${Object.values(SEARCH_PROVIDERS)
            .map(
              (p) => `<button type="button" role="radio" class="search-option" data-search="${p.id}">
                <span class="radio" aria-hidden="true"></span>
                <span><span class="provider-name">${p.label}</span><span class="provider-blurb">${p.note}</span></span>
              </button>`
            )
            .join("")}
        </div>
        <div id="search-key-row" class="key-row" hidden>
          <input id="search-key" type="password" aria-label="Chave da busca de fontes" autocomplete="off" spellcheck="false" />
        </div>
        <p class="hint" id="search-hint"></p>
      </section>

      <section class="field">
        <p class="field-label">Afirmações por verificação</p>
        <div class="segmented small" role="radiogroup" aria-label="Afirmações por verificação">
          ${MAX_CLAIMS_OPTIONS.map((n) => `<button type="button" class="segment" role="radio" data-max="${n}">${n}</button>`).join("")}
        </div>
        <p class="hint">Mais afirmações levam mais tempo e gastam mais chamadas ao modelo.</p>
      </section>`
      }

      <div class="setup-actions">
        <button type="button" class="btn primary block" id="save-btn">${onboarding ? "Salvar e começar" : "Salvar"}</button>
        ${onboarding ? "" : `<button type="button" class="link danger" id="clear-btn">Apagar as chaves deste navegador</button>`}
      </div>
    </div>`;

  const $ = (sel) => view.querySelector(sel);
  const keyInput = $("#key-input");
  const modelSelect = $("#model-select");
  const modelCustom = $("#model-custom");
  const testStatus = $("#test-status");

  function setTestStatus(status, text) {
    tested = status ? { ok: status === "ok" } : null;
    testStatus.className = `test-status ${status || ""}`;
    testStatus.innerHTML = text;
  }

  function syncProvider() {
    const p = LLM_PROVIDERS[draft.llmProvider];
    view.querySelectorAll("[data-provider]").forEach((el) => el.setAttribute("aria-checked", String(el.dataset.provider === p.id)));
    $("#key-label").textContent = `Chave ${providerName(p.id, "de")}`;
    keyInput.placeholder = p.keyHint;
    keyInput.value = draft.llmKeys[p.id] || "";
    $("#key-hint").innerHTML = `Ainda não tem? <a href="${p.keyUrl}" target="_blank" rel="noreferrer">Criar chave ${providerName(p.id, "em")}</a>`;

    const current = draft.llmModels[p.id] || "";
    const known = p.models.some((m) => m.id === current);
    modelSelect.innerHTML =
      p.models
        .map((m) => `<option value="${attr(m.id)}">${escapeHtml(m.label)}${m.id === p.defaultModel ? " (padrão)" : ""}</option>`)
        .join("") + `<option value="__custom">Outro modelo…</option>`;
    modelSelect.value = !current ? p.defaultModel : known ? current : "__custom";
    modelCustom.hidden = modelSelect.value !== "__custom";
    modelCustom.value = known ? "" : current;
    syncModelHint();
    setTestStatus(null, "");
  }

  function syncModelHint() {
    const p = LLM_PROVIDERS[draft.llmProvider];
    const id = modelSelect.value === "__custom" ? modelCustom.value.trim() : modelSelect.value;
    $("#model-hint").innerHTML =
      p.id === "openrouter"
        ? `Dá para usar outro modelo do <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">catálogo da OpenRouter</a>.${
            id ? ` Id: <code>${escapeHtml(id)}</code>` : ""
          }`
        : id
          ? `Id: <code>${escapeHtml(id)}</code>`
          : "";
  }

  function readModel() {
    const p = LLM_PROVIDERS[draft.llmProvider];
    const id = modelSelect.value === "__custom" ? modelCustom.value.trim() : modelSelect.value;
    draft.llmModels[p.id] = id === p.defaultModel ? "" : id;
  }

  function checkKeyProvider() {
    const key = keyInput.value.trim();
    const guess = guessProviderFromKey(key);
    const hint = $("#key-hint");
    hint.querySelector(".switch")?.remove();
    if (guess && guess !== draft.llmProvider) {
      const span = document.createElement("span");
      span.className = "switch";
      span.innerHTML = ` Parece uma chave ${providerName(guess, "de")}. <button type="button" class="link">Usar ${LLM_PROVIDERS[guess].label}</button>`;
      span.querySelector("button").addEventListener("click", () => {
        delete draft.llmKeys[draft.llmProvider];
        draft.llmProvider = guess;
        draft.llmKeys[guess] = key;
        syncProvider();
      });
      hint.append(span);
    }
  }

  view.querySelectorAll("[data-provider]").forEach((el) =>
    el.addEventListener("click", () => {
      draft.llmProvider = el.dataset.provider;
      syncProvider();
    })
  );
  keyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("#test-btn").click();
  });
  keyInput.addEventListener("input", () => {
    draft.llmKeys[draft.llmProvider] = keyInput.value.trim();
    setTestStatus(null, "");
    checkKeyProvider();
  });
  $("#key-eye").addEventListener("click", () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
    $("#key-eye").setAttribute("aria-label", keyInput.type === "password" ? "Mostrar chave" : "Ocultar chave");
    $("#key-eye").title = keyInput.type === "password" ? "Mostrar chave" : "Ocultar chave";
  });
  modelSelect.addEventListener("change", () => {
    modelCustom.hidden = modelSelect.value !== "__custom";
    if (!modelCustom.hidden) modelCustom.focus();
    readModel();
    syncModelHint();
    setTestStatus(null, "");
  });
  modelCustom.addEventListener("input", () => {
    readModel();
    syncModelHint();
    setTestStatus(null, "");
  });

  $("#test-btn").addEventListener("click", async () => {
    readModel();
    const btn = $("#test-btn");
    btn.disabled = true;
    setTestStatus("pending", `<span class="spinner" aria-hidden="true"></span>Testando…`);
    const res = await sendMessage({ type: "CLAIMCHECK_TEST_CONNECTION", settings: draft });
    btn.disabled = false;
    if (res?.ok) {
      setTestStatus("ok", `Conexão ok. ${escapeHtml(res.model)} respondeu em ${(res.elapsedMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s.`);
    } else {
      setTestStatus("fail", escapeHtml(res?.error || "Não foi possível conectar."));
    }
  });

  if (!onboarding) {
    const searchKey = $("#search-key");
    const syncSearch = () => {
      const s = SEARCH_PROVIDERS[draft.searchProvider];
      view.querySelectorAll("[data-search]").forEach((el) => el.setAttribute("aria-checked", String(el.dataset.search === s.id)));
      $("#search-key-row").hidden = !s.needsKey;
      searchKey.placeholder = s.keyHint || "";
      searchKey.value = draft.searchKeys[s.id] || "";
      $("#search-hint").innerHTML = s.needsKey
        ? `Chave da ${s.id === "tavily" ? "Tavily" : "Brave Search"}: <a href="${s.keyUrl}" target="_blank" rel="noreferrer">criar chave</a>`
        : "";
    };
    view.querySelectorAll("[data-search]").forEach((el) =>
      el.addEventListener("click", () => {
        draft.searchProvider = el.dataset.search;
        syncSearch();
      })
    );
    searchKey.addEventListener("input", () => {
      draft.searchKeys[draft.searchProvider] = searchKey.value.trim();
    });
    const syncMax = () =>
      view.querySelectorAll("[data-max]").forEach((el) => el.setAttribute("aria-checked", String(Number(el.dataset.max) === draft.maxClaims)));
    view.querySelectorAll("[data-max]").forEach((el) =>
      el.addEventListener("click", () => {
        draft.maxClaims = Number(el.dataset.max);
        syncMax();
      })
    );
    $("[data-back]").addEventListener("click", closeSetup);
    // Confirmação em dois cliques: diálogos do navegador não são confiáveis no painel lateral.
    let armed = null;
    $("#clear-btn").addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      if (!armed) {
        btn.textContent = "Clique de novo para apagar todas as chaves";
        armed = setTimeout(() => {
          armed = null;
          btn.textContent = "Apagar as chaves deste navegador";
        }, 4000);
        return;
      }
      clearTimeout(armed);
      await chrome.storage.local.set({ llmKeys: {}, searchKeys: {} });
      await chrome.storage.local.remove(["llmApiKey", "searchApiKey"]);
      await loadStored();
      showToast("Chaves apagadas.");
      render();
    });
    syncSearch();
    syncMax();
  }

  $("#save-btn").addEventListener("click", async () => {
    readModel();
    const search = SEARCH_PROVIDERS[draft.searchProvider];
    if (search.needsKey && !draft.searchKeys[search.id]) {
      showToast(`Cole a chave da busca ou escolha Só Wikipedia.`);
      return;
    }
    if (!draft.llmKeys[draft.llmProvider] && !state.devMock) {
      setTestStatus("fail", "Cole a chave antes de salvar.");
      keyInput.focus();
      return;
    }
    await chrome.storage.local.set(normalizeStored(draft));
    await chrome.storage.local.remove(["llmApiKey", "llmModel", "searchApiKey"]);
    await loadStored();
    state.screen = "home";
    showToast(tested?.ok === false ? "Salvo, mas o teste de conexão falhou." : "Configurações salvas.");
    render();
  });

  syncProvider();
  keyInput.focus();
}

/* ------------------------------------------------------------------ helpers */

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

let toastTimer;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3200);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Mesma página, ignorando a âncora (#seção). */
function samePage(a, b) {
  return String(a || "").split("#")[0] === String(b || "").split("#")[0];
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

/** Inicial do domínio sobre uma cor derivada dele. Não depende de serviço de favicon. */
function avatar(domain, size = "") {
  const name = String(domain || "?");
  const base = name.replace(/^(m|mobile|en|pt|es|fr|de)\./, "");
  let hash = 0;
  for (const ch of base) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const letter = base.charAt(0).toUpperCase() || "?";
  return `<span class="avatar ${size}" style="--h:${hash}" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

/** Na Wikipedia o título do artigo diz mais que o domínio; nas outras fontes, o domínio. */
function sourceLabel(source) {
  const wiki = /wikipedia\.org$/.test(source.domain || "");
  if (!wiki) return source.domain;
  const lang = (source.domain.match(/^([a-z]{2,3})\./) || [])[1] || "";
  return `${truncate(cleanTitle(source.title), 30)}${lang ? ` (${lang.toUpperCase()})` : ""}`;
}

function cleanTitle(title) {
  return String(title || "").replace(/\s*\(Wikipedia [A-Z]+\)$/, "");
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

/** Só links http(s) viram href; qualquer outro esquema é neutralizado. */
function safeUrl(value) {
  const url = String(value ?? "");
  return /^https?:\/\//i.test(url) ? attr(url) : "#";
}
