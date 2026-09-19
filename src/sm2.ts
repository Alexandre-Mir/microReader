import { ReviewItem, PluginData } from "./types";

export function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTomorrowString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class SM2Engine {
  static getPendingReviews(data: PluginData): ReviewItem[] {
    const today = getTodayString();
    const maxDaily = data.settings.maxReviewsPerDay;
    const completedToday = data.dailyStats[today] || 0;
    const quota = Math.max(0, maxDaily - completedToday);

    if (quota <= 0) return [];

    const eligible = data.reviews.filter(
      (r) => r.dueDate <= today && !r.isLeech,
    );
    // Ordena pelas mais antigas e id
    eligible.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return eligible.slice(0, quota);
  }

  static hasPendingReviews(data: PluginData): boolean {
    return SM2Engine.getPendingReviews(data).length > 0;
  }

  static processIncrementalReview(
    item: ReviewItem,
    direction: "up" | "down",
    leechThreshold: number = 3,
  ): ReviewItem {
    const lastDirection = item.lastDirection ?? null;
    const lastStep = typeof item.lastStep === "number" && !isNaN(item.lastStep) ? item.lastStep : 0;
    const stageIndex = typeof item.stageIndex === "number" && !isNaN(item.stageIndex) ? item.stageIndex : 0;
    const resetCount = typeof item.resetCount === "number" && !isNaN(item.resetCount) ? item.resetCount : 0;

    // calcula o tamanho do passo: dobra se repetiu a mesma direção, senão volta a 1
    const step = direction === lastDirection ? Math.max(1, lastStep * 2) : 1;

    // aplica o passo ao stageIndex, saturando em -100 / +100
    let newStageIndex = stageIndex;
    if (direction === "up") {
      newStageIndex = Math.min(100, stageIndex + step);
    } else {
      newStageIndex = Math.max(-100, stageIndex - step);
    }

    // se bateu o teto (+100), dispara o reset de "esqueci"
    if (newStageIndex >= 100) {
      const newResetCount = resetCount + 1;
      return {
        ...item,
        stageIndex: 0,
        lastDirection: null,
        lastStep: 0,
        resetCount: newResetCount,
        isLeech: newResetCount >= leechThreshold,
        repetitionNumber: 0,
        intervalDays: 1,
        dueDate: getTomorrowString(),
        lastReviewedAt: new Date().toISOString(),
        rewriteHistory: Array.isArray(item.rewriteHistory) ? item.rewriteHistory : [],
      };
    }

    // caso normal: converte o stageIndex numa qualidade SM-2
    const q = 2.5 - (newStageIndex / 100) * 2.5;

    // roda a fórmula clássica do SM-2 com esse q
    let rep = typeof item.repetitionNumber === "number" && !isNaN(item.repetitionNumber) ? item.repetitionNumber : 0;
    let interval = typeof item.intervalDays === "number" && !isNaN(item.intervalDays) ? item.intervalDays : 1;
    let ef = typeof item.easinessFactor === "number" && !isNaN(item.easinessFactor) ? item.easinessFactor : 2.5;

    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < 1.3) ef = 1.3;

    if (q < 3) {
      rep = 0;
      interval = 1;
    } else {
      if (rep === 0) {
        interval = 1;
      } else if (rep === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * ef);
      }
      rep += 1;
    }

    const today = getTodayString();
    const nextDue = addDays(today, Math.max(1, interval));

    return {
      ...item,
      stageIndex: newStageIndex,
      lastDirection: direction,
      lastStep: step,
      resetCount: resetCount,
      isLeech: Boolean(item.isLeech),
      repetitionNumber: rep,
      intervalDays: Math.max(1, interval),
      easinessFactor: Number(ef.toFixed(2)),
      dueDate: nextDue,
      lastReviewedAt: new Date().toISOString(),
      rewriteHistory: Array.isArray(item.rewriteHistory) ? item.rewriteHistory : [],
    };
  }
}
