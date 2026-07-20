(function () {
  if (window.__claimCheckContentLoaded) return;
  window.__claimCheckContentLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CLAIMCHECK_EXTRACT") return false;

    try {
      const mode = message.mode || "article";
      let text = "";

      if (mode === "selection") {
        text = window.ClaimCheckExtract.extractSelection();
        if (!text) {
          sendResponse({
            ok: false,
            error: "Nenhum texto selecionado. Selecione um trecho na página e tente de novo.",
          });
          return true;
        }
      } else {
        text = window.ClaimCheckExtract.extractArticle();
        if (!text || text.length < 40) {
          sendResponse({
            ok: false,
            error: "Não foi possível extrair texto suficiente desta página.",
          });
          return true;
        }
      }

      sendResponse({
        ok: true,
        text,
        url: location.href,
        title: document.title || "",
        mode,
      });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err?.message || "Falha ao extrair texto da página.",
      });
    }

    return true;
  });
})();
