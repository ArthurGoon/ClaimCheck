// Extração do texto da página. Roda dentro da aba (injetado pelo background).
(function (global) {
  const MAX_CHARS = 12000;

  // Partes da página que não são o texto principal.
  const NOISE = [
    "script",
    "style",
    "noscript",
    "svg",
    "iframe",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "button",
    "figure",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[role='complementary']",
    // Wikipedia: caixa de informações, navegação, notas e "editar"
    ".infobox",
    ".navbox",
    ".toc",
    ".mw-editsection",
    ".reference",
    ".reflist",
    ".thumb",
    ".hatnote",
    ".metadata",
  ].join(",");

  const NOISY_CLASS = /(^|[\s_-])(nav|menu|sidebar|footer|cookie|banner|ads?|advert|promo|related|share|social|comment|newsletter|subscribe)([\s_-]|$)/i;

  const PREFERRED = [
    "#mw-content-text .mw-parser-output",
    "article",
    "[role='main']",
    "main",
    "[itemprop='articleBody']",
    ".post-content",
    ".entry-content",
    ".article-body",
    ".article-content",
    "#content",
  ];

  function clean(text) {
    return String(text || "")
      .replace(/\[\d+\]|\[[a-z]\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isNoise(el, root) {
    for (let node = el; node && node !== root; node = node.parentElement) {
      if (node.matches(NOISE)) return true;
      const cls = typeof node.className === "string" ? node.className : "";
      if (cls && NOISY_CLASS.test(cls)) return true;
    }
    return false;
  }

  /** Texto dos blocos (parágrafos, itens, títulos) dentro de root, um por linha. */
  function blocksText(root) {
    const lines = [];
    const seen = new Set();
    for (const el of root.querySelectorAll("p, li, h1, h2, h3, h4, blockquote, dd")) {
      if (el.tagName === "LI" && el.querySelector("p, li")) continue;
      if (el.parentElement?.closest("p, li, blockquote")) continue;
      if (isNoise(el, root) || !isVisible(el)) continue;
      const text = clean(el.innerText);
      const isHeading = /^H\d$/.test(el.tagName);
      if (!text || (!isHeading && text.length < 30) || seen.has(text)) continue;
      seen.add(text);
      lines.push(text);
    }
    return lines.join("\n");
  }

  function pickRoot() {
    for (const selector of PREFERRED) {
      const candidates = [...document.querySelectorAll(selector)].filter(isVisible);
      const best = candidates
        .map((el) => ({ el, size: (el.innerText || "").length }))
        .sort((a, b) => b.size - a.size)[0];
      if (best && best.size > 400) return best.el;
    }
    return document.body;
  }

  function limitText(text) {
    return { text: text.slice(0, MAX_CHARS), totalChars: text.length, truncated: text.length > MAX_CHARS };
  }

  function extractArticleInfo() {
    const root = pickRoot();
    let text = blocksText(root);
    if (text.length < 200 && root !== document.body) text = blocksText(document.body);
    if (text.length < 200) {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll(NOISE).forEach((n) => n.remove());
      text = clean(clone.textContent);
    }

    const title = clean(document.title);
    if (title && text && !text.startsWith(title)) text = `${title}\n\n${text}`;
    return limitText(text);
  }

  function extractArticle() {
    return extractArticleInfo().text;
  }

  function extractSelection() {
    const sel = window.getSelection();
    return sel ? clean(sel.toString()) : "";
  }

  global.ClaimCheckExtract = { extractSelection, extractArticle, extractArticleInfo, limitText };
})(typeof window !== "undefined" ? window : self);
