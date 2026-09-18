import { TextSimilarity } from "../parser";

describe("TextSimilarity", () => {
  it("deve retornar 100% para textos idênticos", () => {
    const text = "O rato roeu a roupa do rei de Roma.";
    const similarity = TextSimilarity.calculateSimilarityPercent(text, text);

    expect(similarity).toBe(100);
  });

  it("deve retornar baixa similaridade para textos completamente diferentes", () => {
    const textA = "Desenvolvimento de software e inteligência artificial.";
    const textB = "Receita de bolo de chocolate com cobertura.";
    const similarity = TextSimilarity.calculateSimilarityPercent(textA, textB);

    expect(similarity).toBeLessThan(20);
  });
});
