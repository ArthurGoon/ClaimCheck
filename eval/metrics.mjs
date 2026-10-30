// Métricas de classificação para o eval (puras, testadas sem rede).

export const LABELS = ["supported", "refuted", "not_enough_evidence"];

/** pairs: [{ expected, predicted }]. Predições fora de LABELS (ex.: "error") contam como erro. */
export function confusionMatrix(pairs, labels = LABELS) {
  const matrix = Object.fromEntries(labels.map((l) => [l, Object.fromEntries([...labels, "error"].map((p) => [p, 0]))]));
  for (const { expected, predicted } of pairs) {
    if (!matrix[expected]) continue;
    const column = labels.includes(predicted) ? predicted : "error";
    matrix[expected][column] += 1;
  }
  return matrix;
}

export function computeMetrics(pairs, labels = LABELS) {
  const matrix = confusionMatrix(pairs, labels);
  const total = pairs.length;
  const correct = pairs.filter((p) => p.expected === p.predicted).length;

  const perClass = {};
  for (const label of labels) {
    const tp = matrix[label][label];
    const support = Object.values(matrix[label]).reduce((a, b) => a + b, 0);
    const predicted = labels.reduce((sum, row) => sum + matrix[row][label], 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[label] = { precision, recall, f1, support };
  }
  const present = labels.filter((l) => perClass[l].support > 0);
  const macroF1 = present.length ? present.reduce((s, l) => s + perClass[l].f1, 0) / present.length : 0;

  return { total, correct, accuracy: total ? correct / total : 0, macroF1, perClass, matrix };
}

export function formatMatrix(matrix, labels = LABELS) {
  const short = { supported: "supp", refuted: "refu", not_enough_evidence: "nee", error: "err" };
  const cols = [...labels, "error"];
  const header = ["esperado \\ previsto".padEnd(22), ...cols.map((c) => short[c].padStart(6))].join("");
  const rows = labels.map((row) => [row.padEnd(22), ...cols.map((c) => String(matrix[row][c]).padStart(6))].join(""));
  return [header, ...rows].join("\n");
}
