(function (global) {
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "SVG",
    "IFRAME",
    "NAV",
    "FOOTER",
    "HEADER",
    "ASIDE",
    "FORM",
    "BUTTON",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION",
  ]);

  const SKIP_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary"]);

  function visibleText(el) {
    if (!(el instanceof Element)) return "";
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return "";
    }
    return (el.innerText || "").replace(/\s+/g, " ").trim();
  }

  function isSkippable(el) {
    if (!(el instanceof Element)) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    const role = el.getAttribute("role");
    if (role && SKIP_ROLES.has(role)) return true;
    const cls = (el.className && String(el.className).toLowerCase()) || "";
    if (/(nav|menu|sidebar|footer|cookie|banner|ads?|comment)/.test(cls)) return true;
    return false;
  }

  function scoreNode(el) {
    const text = visibleText(el);
    if (text.length < 120) return 0;
    const paragraphs = el.querySelectorAll("p");
    const pScore = Math.min(paragraphs.length * 40, 400);
    const lengthScore = Math.min(text.length / 20, 500);
    let linkPenalty = 0;
    const links = el.querySelectorAll("a");
    if (links.length > 0 && text.length > 0) {
      const linkTextLen = Array.from(links).reduce(
        (sum, a) => sum + (a.innerText || "").length,
        0
      );
      if (linkTextLen / text.length > 0.35) linkPenalty = 200;
    }
    return lengthScore + pScore - linkPenalty;
  }

  function extractSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
    return text;
  }

  function extractArticle() {
    const candidates = [];

    const preferred = document.querySelectorAll(
      "article, [role='main'], main, .post-content, .entry-content, .article-body, #content"
    );
    preferred.forEach((el) => {
      if (!isSkippable(el)) candidates.push({ el, score: scoreNode(el) + 150 });
    });

    document.querySelectorAll("div, section").forEach((el) => {
      if (isSkippable(el)) return;
      const score = scoreNode(el);
      if (score > 200) candidates.push({ el, score });
    });

    candidates.sort((a, b) => b.score - a.score);

    let text = "";
    if (candidates.length > 0) {
      text = visibleText(candidates[0].el);
    }

    if (!text || text.length < 80) {
      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll(
        "script, style, noscript, nav, footer, header, aside, iframe, svg, form"
      ).forEach((n) => n.remove());
      text = (bodyClone.innerText || "").replace(/\s+/g, " ").trim();
    }

    const title = (document.title || "").trim();
    if (title && text && !text.startsWith(title)) {
      text = `${title}\n\n${text}`;
    }

    return text.slice(0, 12000);
  }

  global.ClaimCheckExtract = {
    extractSelection,
    extractArticle,
  };
})(typeof window !== "undefined" ? window : self);
