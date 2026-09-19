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

  it("deve detectar similaridade alta quando pequenas alterações são feitas", () => {
    const original = "O Iluminismo representou uma mudança profunda na história do pensamento europeu ocidental.";
    const slightlyModified = "O Iluminismo representou uma mudança profunda na história do pensamento europeu moderno.";
    const similarity = TextSimilarity.calculateSimilarityPercent(original, slightlyModified);

    expect(similarity).toBeGreaterThan(55);
  });

  it("deve aprovar quando o usuário reescreve com suas próprias palavras", () => {
    const original = "O Iluminismo representou uma mudança profunda na história do pensamento europeu ocidental.";
    const rewritten = "A era das luzes transformou radicalmente a filosofia e a ciência no continente europeu.";
    const similarity = TextSimilarity.calculateSimilarityPercent(original, rewritten);

    expect(similarity).toBeLessThanOrEqual(55);
  });
});
