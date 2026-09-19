import { SM2Engine, getTodayString } from "../sm2";
import { ReviewItem, PluginData } from "../types";

describe("SM2Engine Incremental Review", () => {
  it("deve processar item legado com propriedades ausentes sem gerar NaN", () => {
    const legacyItem: ReviewItem = {
      id: "note#1#123",
      sourceFilePath: "Biblioteca/livro.md",
      paragraphIndex: 1,
      originalText: "Texto original",
      rewrittenText: "Texto sintetizado",
      zettelTitle: "Nota Zettel",
      repetitionNumber: 0,
      intervalDays: 1,
      easinessFactor: 2.5,
      dueDate: "2026-09-14",
    } as any;

    const resultUp = SM2Engine.processIncrementalReview(legacyItem, "up", 3);
    expect(isNaN(resultUp.stageIndex)).toBe(false);
    expect(resultUp.stageIndex).toBe(1);
    expect(resultUp.lastStep).toBe(1);
    expect(resultUp.lastDirection).toBe("up");
    expect(isNaN(resultUp.easinessFactor)).toBe(false);
    expect(resultUp.dueDate).not.toContain("NaN");
    expect(Array.isArray(resultUp.rewriteHistory)).toBe(true);

    const resultDown = SM2Engine.processIncrementalReview(legacyItem, "down", 3);
    expect(isNaN(resultDown.stageIndex)).toBe(false);
    expect(resultDown.stageIndex).toBe(-1);
    expect(resultDown.lastStep).toBe(1);
    expect(resultDown.lastDirection).toBe("down");
    expect(resultDown.dueDate).not.toContain("NaN");
  });

  it("deve dobrar o passo quando a direção se repete", () => {
    const item: ReviewItem = {
      id: "note#1#123",
      sourceFilePath: "Biblioteca/livro.md",
      paragraphIndex: 1,
      originalText: "Texto original",
      rewrittenText: "Texto sintetizado",
      zettelTitle: "Nota Zettel",
      repetitionNumber: 1,
      intervalDays: 1,
      easinessFactor: 2.5,
      dueDate: "2026-09-18",
      stageIndex: 1,
      lastDirection: "up",
      lastStep: 1,
      resetCount: 0,
      isLeech: false,
      rewriteHistory: [],
    };

    const step2 = SM2Engine.processIncrementalReview(item, "up", 3);
    expect(step2.lastStep).toBe(2);
    expect(step2.stageIndex).toBe(3);

    const step3 = SM2Engine.processIncrementalReview(step2, "up", 3);
    expect(step3.lastStep).toBe(4);
    expect(step3.stageIndex).toBe(7);

    // Mudou de direção -> volta para passo 1
    const stepDown = SM2Engine.processIncrementalReview(step3, "down", 3);
    expect(stepDown.lastStep).toBe(1);
    expect(stepDown.stageIndex).toBe(6);
  });

  it("deve identificar leech quando atinge o teto e o limiar", () => {
    const itemNearReset: ReviewItem = {
      id: "note#1#123",
      sourceFilePath: "Biblioteca/livro.md",
      paragraphIndex: 1,
      originalText: "Texto original",
      rewrittenText: "Texto sintetizado",
      zettelTitle: "Nota Zettel",
      repetitionNumber: 3,
      intervalDays: 10,
      easinessFactor: 2.5,
      dueDate: "2026-09-18",
      stageIndex: 99,
      lastDirection: "up",
      lastStep: 1,
      resetCount: 2,
      isLeech: false,
      rewriteHistory: [],
    };

    const resetItem = SM2Engine.processIncrementalReview(itemNearReset, "up", 3);
    expect(resetItem.stageIndex).toBe(0);
    expect(resetItem.resetCount).toBe(3);
    expect(resetItem.isLeech).toBe(true);
    expect(resetItem.repetitionNumber).toBe(0);
    expect(resetItem.intervalDays).toBe(1);
  });
});
