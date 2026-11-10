// Injetado sob demanda pelo background (chrome.scripting), junto com lib/extract.js.
// Expõe duas funções para o background chamar: extrair o texto e destacar um trecho.
(function () {
  const HIGHLIGHT_NAME = "claimcheck";

  function extract(mode) {
    const extractor = window.ClaimCheckExtract;
    const page = mode === "selection" ? extractor.limitText(extractor.extractSelection()) : extractor.extractArticleInfo();
    return { ...page, url: location.href, title: document.title || "", mode };
  }

  // Normalização usada dos dois lados da busca: só letras e números, minúsculos.
  // Assim aspas curvas, travessões, espaços e pontuação não atrapalham a comparação.
  function isWordChar(ch) {
    return /[\p{L}\p{N}]/u.test(ch);
  }

  function normalize(text) {
    let out = "";
    for (const ch of String(text || "")) if (isWordChar(ch)) out += ch.toLowerCase().charAt(0);
    return out;
  }

  /** Texto visível da página achatado, com o mapa de cada caractere para (nó, offset). */
  function flattenPage() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Notas de rodapé ([12] da Wikipedia) e código não fazem parte da frase.
        if (parent.closest("script, style, noscript, textarea, sup")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let flat = "";
    const map = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i += 1) {
        if (isWordChar(value[i])) {
          flat += value[i].toLowerCase().charAt(0);
          map.push([node, i]);
        }
      }
    }
    return { flat, map };
  }

  function visibleRange(flat, map, needle) {
    if (needle.length < 12) return null;
    let from = 0;
    while (true) {
      const start = flat.indexOf(needle, from);
      if (start === -1) return null;
      const [startNode, startOffset] = map[start];
      const [endNode, endOffset] = map[start + needle.length - 1];
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return range;
      from = start + 1;
    }
  }

  /** Procura o trecho citado; se não achar inteiro, tenta pedaços dele e depois o texto do claim. */
  function findRange(quote, claim) {
    const { flat, map } = flattenPage();
    const candidates = [];
    for (const source of [quote, claim]) {
      const needle = normalize(source);
      if (!needle) continue;
      candidates.push(needle);
      if (needle.length > 60) {
        candidates.push(needle.slice(0, Math.ceil(needle.length * 0.6)));
        candidates.push(needle.slice(-Math.ceil(needle.length * 0.6)));
        candidates.push(needle.slice(0, 40));
      }
    }
    for (const needle of candidates) {
      const range = visibleRange(flat, map, needle);
      if (range) return range;
    }
    return null;
  }

  function ensureStyle() {
    if (document.getElementById("claimcheck-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "claimcheck-highlight-style";
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(250, 204, 21, 0.55); color: inherit; }`;
    (document.head || document.documentElement).append(style);
  }

  function highlight(quote, claim) {
    const range = findRange(quote, claim);
    if (!range || typeof Highlight === "undefined" || !CSS.highlights) return false;
    ensureStyle();
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
    const target = range.startContainer.parentElement;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  window.ClaimCheckPage = { extract, highlight };
})();
