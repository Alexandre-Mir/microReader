import { App, TFile } from "obsidian";

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

    const noteBody = `${content}\n\n---\n${tagFormatted}\n\n**Origem:** [[${sourceBaseName}]]\n`;

    // Salva na mesma pasta do arquivo de origem ou na raiz
    const parentPath = sourceFile.parent?.path || "";
    const filePath = parentPath ? `${parentPath}/${cleanTitle}.md` : `${cleanTitle}.md`;

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      // Se já existe, anexa
      await this.app.vault.append(existing, `\n\n---\n${content}\n\n**Origem:** [[${sourceBaseName}]]\n`);
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
    const appendText = `\n\n---\n### Adição Incremental\n${content}\n\n**Origem:** [[${sourceBaseName}]]\n`;
    await this.app.vault.append(targetFile, appendText);
  }

  /**
   * Substitui o parágrafo no arquivo de origem por um ou mais links [[Nota Criada]]
   */
  async replaceParagraphWithLinks(
    sourceFile: TFile,
    originalParagraphText: string,
    zettelTitles: string[]
  ): Promise<void> {
    const linkStr = zettelTitles
      .map((t) => `[[${t.replace(/^\[\[|\]\]$/g, "").trim()}]]`)
      .join(" ");

    const fileContent = await this.app.vault.read(sourceFile);

    // Substitui a primeira ocorrência do texto do parágrafo pelo conjunto de links
    if (fileContent.includes(originalParagraphText)) {
      const updated = fileContent.replace(originalParagraphText, linkStr);
      await this.app.vault.modify(sourceFile, updated);
    }
  }

  async replaceParagraphWithLink(
    sourceFile: TFile,
    originalParagraphText: string,
    zettelTitle: string
  ): Promise<void> {
    return this.replaceParagraphWithLinks(sourceFile, originalParagraphText, [zettelTitle]);
  }
}
