// Roteiros do modelo simulado usados por scripts/screenshots.mjs.
// A página e a busca são reais; só as respostas do LLM vêm daqui.
// Os trechos em "quote" foram copiados da página para o destaque funcionar, e os
// vereditos foram escritos depois de ler as evidências que a busca real devolveu
// (novembro de 2026), para o screenshot não mostrar nada que as fontes não digam.

export const SCENARIOS = {
  muro: {
    url: "https://pt.wikipedia.org/wiki/Muro_de_Berlim",
    highlightIndex: 4,
    mock: {
      delayMs: 900,
      extract: {
        page_summary: "Artigo da Wikipedia sobre o Muro de Berlim, da construção em 1961 à queda em 1989.",
        language: "pt",
        claims: [
          {
            text: "A construção do Muro de Berlim foi iniciada pelo governo da RDA em 13 de agosto de 1961.",
            quote: "A construção do Muro de Berlim foi iniciada pelo governo da RDA em 13 de agosto de 1961",
            context: "Muro de Berlim",
            search_query: "Berlin Wall construction began 13 August 1961",
          },
          {
            text: "O termo \"Muro da Vergonha\" foi cunhado pelo prefeito de Berlim Ocidental Willy Brandt.",
            quote: "um termo cunhado pelo prefeito Willy Brandt",
            context: "Willy Brandt e o Muro de Berlim",
            search_query: "Willy Brandt coined Wall of Shame Berlin Wall",
          },
          {
            text: "Antes da construção do Muro, 3,5 milhões de alemães orientais deixaram a RDA.",
            quote: "Antes da construção do Muro, 3,5 milhões de alemães orientais contornaram as restrições de emigração",
            context: "Emigração da Alemanha Oriental antes do Muro de Berlim",
            search_query: "3.5 million East Germans emigrated before Berlin Wall",
          },
          {
            text: "Em 9 de novembro de 1989 o governo da Alemanha Oriental anunciou que os cidadãos da RDA poderiam visitar a Alemanha Ocidental.",
            quote: "o governo da Alemanha Oriental anunciou em 9 de novembro de 1989 que todos os cidadãos da RDA poderiam visitar a RFA e Berlim Ocidental",
            context: "Queda do Muro de Berlim",
            search_query: "Fall of the Berlin Wall 9 November 1989 announcement",
          },
          {
            text: "O número de cidadãos da RDA que foram para a Alemanha Ocidental foi de 197 mil em 1950 e 331 mil em 1953.",
            quote: "o número de cidadãos da RDA que se deslocam para a Alemanha Ocidental totalizou 197 mil em 1950",
            context: "Emigração da RDA para a Alemanha Ocidental nos anos 1950",
            search_query: "East Germans emigrated West Germany 197,000 1950 331,000 1953",
          },
        ],
      },
      verdicts: [
        {
          match: "13 de agosto de 1961",
          verdict: "supported",
          confidence: 0.95,
          explanation: "A Wikipedia em inglês registra o início da construção pelo governo da RDA em 13 de agosto de 1961.",
          cite: ["Berlin Wall (Wikipedia EN)"],
        },
        {
          match: "Muro da Vergonha",
          delayMs: 2500,
          verdict: "supported",
          confidence: 0.9,
          explanation: "As fontes atribuem a expressão \"Muro da Vergonha\" a Willy Brandt, então prefeito de Berlim Ocidental.",
          cite: ["Muro da vergonha", "Wall of Shame"],
        },
        {
          match: "3,5 milhões",
          delayMs: 2500,
          verdict: "supported",
          confidence: 0.9,
          explanation: "A Wikipedia em inglês cita 3,5 milhões de alemães orientais que deixaram a RDA antes do Muro, cerca de 20% da população.",
          cite: ["Berlin Wall (Wikipedia EN)"],
        },
        {
          match: "9 de novembro de 1989",
          delayMs: 2500,
          verdict: "supported",
          confidence: 0.88,
          explanation: "As fontes registram o anúncio de 9 de novembro de 1989 que liberou as viagens dos alemães orientais.",
          cite: ["Fall of the Berlin Wall", "Queda do Muro de Berlim"],
        },
        {
          match: "197 mil",
          delayMs: 2500,
          verdict: "not_enough_evidence",
          confidence: 0.45,
          explanation: "As fontes trazem esses números, mas para europeus orientais que pediram asilo na Alemanha Ocidental, não só cidadãos da RDA.",
          cite: ["Emigration from the Eastern Bloc", "Berlin Crisis of 1958"],
        },
      ],
    },
  },
};
