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
  fontSizePx: number;  // padrão: 20
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
