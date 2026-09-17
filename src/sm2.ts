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

    const eligible = data.reviews.filter((r) => r.dueDate <= today);
    // Ordena pelas mais antigas e id
    eligible.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return eligible.slice(0, quota);
  }

  static hasPendingReviews(data: PluginData): boolean {
    return SM2Engine.getPendingReviews(data).length > 0;
  }

  static processReviewResult(item: ReviewItem, quality: number): ReviewItem {
    let q = Math.max(0, Math.min(5, quality));
    let rep = item.repetitionNumber;
    let interval = item.intervalDays;
    let ef = item.easinessFactor;

    // Fórmula SM-2 para Easiness Factor
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
    const nextDue = addDays(today, interval);

    return {
      ...item,
      repetitionNumber: rep,
      intervalDays: interval,
      easinessFactor: ef,
      dueDate: nextDue,
      lastReviewedAt: new Date().toISOString(),
    };
  }
}
