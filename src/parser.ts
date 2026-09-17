export interface ZettelMetrics {
  words: number;
  chars: number;
  statusText: string;
  statusType: "too_short" | "ideal" | "long";
}

export class TextSimilarity {
  /**
   * Remove pontuação, números isolados e converte para minúsculas
   */
  static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);
  }

  /**
   * Gera conjunto de bi-gramas (pares de palavras consecutivas)
   */
  static getBigrams(tokens: string[]): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.add(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return bigrams;
  }

  /**
   * Calcula similaridade de Jaccard baseada em bi-gramas (0 a 100%)
   */
  static calculateSimilarityPercent(original: string, rewritten: string): number {
    const origTokens = this.tokenize(original);
    const rewTokens = this.tokenize(rewritten);

    if (origTokens.length === 0 || rewTokens.length === 0) return 0;

    // Se ambos forem muito curtos (ex: 1 ou 2 palavras), compara diretamente unigramas
    if (origTokens.length < 3 || rewTokens.length < 3) {
      const origSet = new Set(origTokens);
      const rewSet = new Set(rewTokens);
      let intersection = 0;
      for (const t of rewSet) {
        if (origSet.has(t)) intersection++;
      }
      const union = new Set([...origSet, ...rewSet]).size;
      return union === 0 ? 0 : Math.round((intersection / union) * 100);
    }

    const origBigrams = this.getBigrams(origTokens);
    const rewBigrams = this.getBigrams(rewTokens);

    if (origBigrams.size === 0 || rewBigrams.size === 0) return 0;

    let shared = 0;
    for (const bg of rewBigrams) {
      if (origBigrams.has(bg)) shared++;
    }

    // Coeficiente de Sobreposição / Jaccard
    const union = new Set([...origBigrams, ...rewBigrams]).size;
    const similarity = union === 0 ? 0 : (shared / union) * 100;
    return Math.round(similarity);
  }

  /**
   * Avalia a extensão do texto em relação aos parâmetros ideais de um Zettel
   */
  static evaluateZettelLength(text: string): ZettelMetrics {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).filter((w) => w.length > 0).length : 0;
    const chars = trimmed.length;

    if (words < 40) {
      return {
        words,
        chars,
        statusText: `⚠️ Curto (${words} palavras) — Definição rápida`,
        statusType: "too_short",
      };
    } else if (words <= 250) {
      return {
        words,
        chars,
        statusText: `✓ Extensão ideal Zettel (${words} palavras / ~${chars} chars)`,
        statusType: "ideal",
      };
    } else {
      return {
        words,
        chars,
        statusText: `⚠️ Longo (${words} palavras) — Considere desmembrar com '---'`,
        statusType: "long",
      };
    }
  }
}

import { ParagraphBlock } from "./types";

export interface ParsedNoteResult {
  paragraphs: ParagraphBlock[];
  footnotes: Record<string, string>;
}

export class MarkdownParser {
  /**
   * Extrai notas de rodapé estilo Obsidian: [^1]: texto
   */
  static extractFootnotes(content: string): { cleanContent: string; footnotes: Record<string, string> } {
    const footnotes: Record<string, string> = {};
    const lines = content.split("\n");
    const remainingLines: string[] = [];

    const fnStartRegex = /^\[\^([^\]]+)\]:\s*(.*)$/;
    let currentFnId: string | null = null;

    for (const line of lines) {
      const match = fnStartRegex.exec(line);
      if (match) {
        currentFnId = match[1];
        footnotes[currentFnId] = match[2].trim();
      } else if (currentFnId && (line.startsWith("    ") || line.startsWith("\t"))) {
        footnotes[currentFnId] += " " + line.trim();
      } else {
        currentFnId = null;
        remainingLines.push(line);
      }
    }

    return {
      cleanContent: remainingLines.join("\n"),
      footnotes,
    };
  }

  /**
   * Extrai links internos [[x]] de um texto
   */
  static extractInternalLinks(text: string): string[] {
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
      let target = match[1];
      // Trata aliases: [[Nota|Alias]] -> "Nota"
      if (target.includes("|")) {
        target = target.split("|")[0];
      }
      // Trata headers internos: [[Nota#Subtitulo]] -> "Nota"
      if (target.includes("#")) {
        target = target.split("#")[0];
      }
      target = target.trim();
      if (target && !links.includes(target)) {
        links.push(target);
      }
    }
    return links;
  }

  /**
   * Divide o conteúdo em parágrafos semânticos
   */
  static parse(content: string): ParsedNoteResult {
    // Normaliza quebras de linha
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Remove frontmatter YAML se houver
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const contentWithoutFrontmatter = normalized.replace(frontmatterRegex, "");

    // 1. Extrai footnotes
    const { cleanContent, footnotes } = this.extractFootnotes(contentWithoutFrontmatter);

    // 2. Divide em blocos por linhas em branco
    const rawBlocks = cleanContent.split(/\n\s*\n/);
    const paragraphs: ParagraphBlock[] = [];
    let globalIdx = 0;
    let currentSection = 1;

    for (const block of rawBlocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Se for apenas título de seção (# Título)
      if (trimmed.startsWith("#")) {
        currentSection++;
        continue;
      }

      // Limpa linhas mantendo o bloco fluido
      const cleanText = trimmed
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join(" ");

      if (cleanText.length >= 10) {
        paragraphs.push({
          index: globalIdx,
          text: cleanText,
          section: currentSection,
          internalLinks: this.extractInternalLinks(cleanText),
        });
        globalIdx++;
      }
    }

    return { paragraphs, footnotes };
  }
}
