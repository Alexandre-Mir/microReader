import { App, TFile } from "obsidian";
import { ZettelFooterParser } from "./parser";

export class ZettelManager {
  constructor(private app: App) {}

  /**
   * Verifica se a nota possui a tag exigida (ex: #zettel)
   */
  hasZettelTag(file: TFile, requiredTag: string = "zettel"): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;

    const cleanTag = requiredTag.replace(/^#/, "").toLowerCase();

    // 1. Verifica tags no frontmatter
    if (cache.frontmatter && cache.frontmatter.tags) {
      const tags = cache.frontmatter.tags;
      if (Array.isArray(tags)) {
        if (tags.some((t) => String(t).replace(/^#/, "").toLowerCase() === cleanTag)) return true;
      } else if (typeof tags === "string") {
        if (tags.split(/[\s,]+/).some((t) => t.replace(/^#/, "").toLowerCase() === cleanTag)) return true;
      }
    }

    // 2. Verifica tags no corpo da nota
    if (cache.tags) {
      if (cache.tags.some((t) => t.tag.replace(/^#/, "").toLowerCase() === cleanTag)) return true;
    }

    return false;
  }

  /**
   * Lista todas as notas do Vault que possuem a tag #zettel
   */
  getAllZettelFiles(requiredTag: string = "zettel"): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    return files.filter((f) => this.hasZettelTag(f, requiredTag));
  }

  /**
   * Cria uma nova nota Zettelkasten:
   * - Contém a síntese
   * - Adiciona a tag #zettel
   * - Referencia no final o arquivo de origem [[Origem]]
   */
  async createZettelNote(
    title: string,
    content: string,
    sourceFile: TFile,
    requiredTag: string = "zettel"
  ): Promise<TFile> {
    const cleanTitle = title.replace(/[\\/:*?"<>|]/g, "").replace(/^\[\[|\]\]$/g, "").trim();
    const sourceBaseName = sourceFile.basename;
    const tagFormatted = requiredTag.startsWith("#") ? requiredTag : `#${requiredTag}`;

    const noteBody = `${content}\n\n<!-- microreader:footer -->\n${tagFormatted}\n\n**Origem:** [[${sourceBaseName}]]\n`;

    // Salva na mesma pasta do arquivo de origem ou na raiz
    const parentPath = sourceFile.parent?.path || "";
    const filePath = parentPath ? `${parentPath}/${cleanTitle}.md` : `${cleanTitle}.md`;

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      // Se já existe, anexa
      await this.mergeWithExistingZettel(existing, content, sourceFile);
      return existing;
    }

    return await this.app.vault.create(filePath, noteBody);
  }

  /**
   * Mescla a nova síntese com uma nota Zettel existente
   */
  async mergeWithExistingZettel(
    targetFile: TFile,
    content: string,
    sourceFile: TFile
  ): Promise<void> {
    const sourceBaseName = sourceFile.basename;
    const fileContent = await this.app.vault.read(targetFile);
    const { body, footer } = ZettelFooterParser.split(fileContent);

    const newBody = `${body}\n\n---\n### Adição Incremental\n${content}`;
    const newFooter = footer.includes(sourceBaseName)
      ? footer
      : `${footer}\n**Origem:** [[${sourceBaseName}]]`;

    await this.app.vault.modify(targetFile, ZettelFooterParser.join(newBody, newFooter));
  }

  /**
   * Substitui o parágrafo no arquivo de origem por um ou mais links [[Nota Criada]]
   */
  async replaceParagraphWithLinks(
    sourceFile: TFile,
    originalParagraphText: string,
    zettelTitles: string[],
    rawParagraphText?: string
  ): Promise<void> {
    const linkStr = zettelTitles
      .map((t) => `[[${t.replace(/^\[\[|\]\]$/g, "").trim()}]]`)
      .join(" ");

    const fileContent = await this.app.vault.read(sourceFile);

    // 1. Tenta substituir pelo texto bruto original exato
    if (rawParagraphText && fileContent.includes(rawParagraphText)) {
      const updated = fileContent.replace(rawParagraphText, linkStr);
      await this.app.vault.modify(sourceFile, updated);
      return;
    }

    // 2. Tenta substituir pelo texto formatado (com espaços normalizados)
    if (fileContent.includes(originalParagraphText)) {
      const updated = fileContent.replace(originalParagraphText, linkStr);
      await this.app.vault.modify(sourceFile, updated);
      return;
    }

    // 3. Busca por blocos no arquivo com tolerância a quebras de linha
    const blocks = fileContent.split(/\n\s*\n/);
    const targetIdx = blocks.findIndex((b) => {
      const normalizedB = b
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join(" ");
      return normalizedB === originalParagraphText;
    });

    if (targetIdx !== -1) {
      blocks[targetIdx] = linkStr;
      await this.app.vault.modify(sourceFile, blocks.join("\n\n"));
    }
  }

  async replaceParagraphWithLink(
    sourceFile: TFile,
    originalParagraphText: string,
    zettelTitle: string,
    rawParagraphText?: string
  ): Promise<void> {
    return this.replaceParagraphWithLinks(sourceFile, originalParagraphText, [zettelTitle], rawParagraphText);
  }
}
