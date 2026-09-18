export interface ReviewItem {
  id: string;
  sourceFilePath: string;
  paragraphIndex: number;
  originalText: string;
  rewrittenText: string;
  zettelTitle: string;
  repetitionNumber: number;
  intervalDays: number;
  easinessFactor: number;
  dueDate: string; // YYYY-MM-DD
  lastReviewedAt?: string;
  stageIndex: number; // -100 a +100, começa em 0
  lastDirection: "up" | "down" | null; // direção do último toque (null = ainda não revisado)
  lastStep: number; // tamanho do último passo aplicado (começa em 0)
  resetCount: number; // quantas vezes esse Zettel já bateu +100
  isLeech: boolean; // true qunado resetCount >= limiar configurado
  rewriteHistory: { date: string; text: string }[];
}

export interface DocumentState {
  filePath: string;
  title: string;
  currentParagraphIndex: number;
  completedParagraphs: number[];
  ignoredParagraphs: number[];
  totalParagraphs: number;
  lastReadAt: string;
}

export interface MicroReaderSettings {
  maxReviewsPerDay: number;
  minRewriteWords: number;
  maxSimilarityPercent: number; // padrão: 55 (%)
  autoTagZettel: boolean;
  requiredTag: string; // padrão: 'zettel'
  fontSizePx: number; // padrão: 20
  leechThreshold: number; // quantos resets até virar leech (defautl: 3)
}

export interface PluginData {
  settings: MicroReaderSettings;
  reviews: ReviewItem[];
  documents: Record<string, DocumentState>;
  dailyStats: Record<string, number>; // dateString -> count
}

export interface ParagraphBlock {
  index: number;
  text: string;
  section: number;
  internalLinks: string[]; // nomes das notas linkadas com [[x]]
}
