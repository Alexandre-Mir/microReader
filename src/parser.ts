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
          rawText: trimmed,
          section: currentSection,
          internalLinks: this.extractInternalLinks(cleanText),
        });
        globalIdx++;
      }
    }

    return { paragraphs, footnotes };
  }

  /**
   * Substitui um parágrafo por índice estrutural com verificação segura de ocorrências
   */
  static replaceParagraph(
    content: string,
    target: ReplaceParagraphTarget,
    replacement: string
  ): ReplaceParagraphResult {
    const isCRLF = content.includes("\r\n");
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Determina o texto de busca: prefere rawText se estiver presente no conteúdo
    let searchStr = "";
    if (target.rawText && normalized.includes(target.rawText)) {
      searchStr = target.rawText;
    } else if (target.text && normalized.includes(target.text)) {
      searchStr = target.text;
    } else {
      // Tenta localizar através do parse estrutural caso o texto tenha quebras de linha normalizadas
      const parsedInitial = this.parse(normalized);
      if (target.index !== undefined && parsedInitial.paragraphs[target.index]) {
        const found = parsedInitial.paragraphs[target.index];
        if (found.rawText && normalized.includes(found.rawText)) {
          searchStr = found.rawText;
        } else if (found.text && normalized.includes(found.text)) {
          searchStr = found.text;
        }
      }
    }

    if (!searchStr) {
      return {
        success: false,
        occurrencesCount: 0,
        error: "Parágrafo não encontrado no conteúdo do arquivo.",
      };
    }

    // Localiza ocorrências como blocos autônomos
    const findBlockOccurrences = (haystack: string, needle: string): number[] => {
      const positions: number[] = [];
      let pos = 0;
      while ((pos = haystack.indexOf(needle, pos)) !== -1) {
        const before = haystack.slice(0, pos);
        const after = haystack.slice(pos + needle.length);

        const validBefore = pos === 0 || /\n\s*$/.test(before) || before.endsWith("---\n");
        const validAfter = pos + needle.length === haystack.length || /^\s*\n/.test(after) || after.startsWith("\n");

        if (validBefore && validAfter) {
          positions.push(pos);
        }
        pos += needle.length;
      }
      return positions;
    };

    let occurrences = findBlockOccurrences(normalized, searchStr);
    if (occurrences.length === 0) {
      let pos = 0;
      while ((pos = normalized.indexOf(searchStr, pos)) !== -1) {
        occurrences.push(pos);
        pos += searchStr.length;
      }
    }

    const count = occurrences.length;

    // Se houver exatamente uma ocorrência e target.index não foi passado, substitui diretamente
    if (count === 1 && target.index === undefined) {
      const updated = normalized.slice(0, occurrences[0]) + replacement + normalized.slice(occurrences[0] + searchStr.length);
      return {
        success: true,
        updatedContent: isCRLF ? updated.replace(/\n/g, "\r\n") : updated,
        occurrencesCount: 1,
      };
    }

    // Com índice estrutural ou mais de 1 ocorrência, realiza a validação estrutural via parse
    const parsed = this.parse(normalized);

    if (target.index === undefined || target.index < 0 || target.index >= parsed.paragraphs.length) {
      return {
        success: false,
        occurrencesCount: count,
        error: `Existem ${count} ocorrências do parágrafo, mas o índice estrutural (${target.index}) é inválido.`,
      };
    }

    const blockAtIndex = parsed.paragraphs[target.index];
    const textMatches = blockAtIndex.text === target.text || (target.rawText && blockAtIndex.rawText === target.rawText);
    if (!textMatches) {
      return {
        success: false,
        occurrencesCount: count,
        error: `O bloco no índice ${target.index} não corresponde ao parágrafo esperado. O arquivo pode ter sido modificado externamente.`,
      };
    }

    // Determina qual ocorrência corresponde a este índice estrutural
    let occurrenceIndex = 0;
    for (let i = 0; i < target.index; i++) {
      const p = parsed.paragraphs[i];
      if (p.text === target.text || (target.rawText && p.rawText === target.rawText)) {
        occurrenceIndex++;
      }
    }

    if (occurrenceIndex >= occurrences.length) {
      return {
        success: false,
        occurrencesCount: count,
        error: `Inconsistência estrutural: esperado ocorrência ${occurrenceIndex + 1}, mas apenas ${occurrences.length} encontradas.`,
      };
    }

    const targetPos = occurrences[occurrenceIndex];
    const updated = normalized.slice(0, targetPos) + replacement + normalized.slice(targetPos + searchStr.length);

    return {
      success: true,
      updatedContent: isCRLF ? updated.replace(/\n/g, "\r\n") : updated,
      occurrencesCount: count,
    };
  }
}

export interface ReplaceParagraphTarget {
  text: string;
  rawText?: string;
  index?: number;
}

export interface ReplaceParagraphResult {
  success: boolean;
  updatedContent?: string;
  occurrencesCount: number;
  error?: string;
}

const FOOTER_MARKER = "<!-- microreader:footer -->";

export interface ZettelSplit {
  body: string;
  footer: string; // inclui o marcador
}

export class ZettelFooterParser {
  static split(fileContent: string): ZettelSplit {
    const markerIdx = fileContent.indexOf(FOOTER_MARKER);
    if (markerIdx !== -1) {
      return {
        body: fileContent.substring(0, markerIdx).trim(),
        footer: fileContent.substring(markerIdx).trim(),
      };
    }
    return this.migrateLegacyFormat(fileContent);
  }

  private static migrateLegacyFormat(fileContent: string): ZettelSplit {
    const origemRegex = /\*\*Origem:\*\*\s*\[\[([^\]]+)\]\]/g;
    const origens: string[] = [];
    let match;
    while ((match = origemRegex.exec(fileContent)) !== null) {
      origens.push(match[1]);
    }

    let body = fileContent
      .replace(/^#zettel\s*$/gm, "")
      .replace(/\*\*Origem:\*\*\s*\[\[([^\]]+)\]\]/g, "")
      .replace(/\n{3,}/g, "\n\n") // limpa excesso de linhas em branco deixado pela remoção
      .trim();

    const origensUnicas = [...new Set(origens)];
    const footerLines = [
      FOOTER_MARKER,
      "#zettel",
      ...origensUnicas.map((o) => `**Origem:** [[${o}]]`),
    ];

    return { body, footer: footerLines.join("\n") };
  }

  static join(body: string, footer: string): string {
    return `${body.trim()}\n\n${footer.trim()}\n`;
  }
}
