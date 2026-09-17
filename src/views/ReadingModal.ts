import { App, Modal, Notice, setTooltip, TFile } from "obsidian";
import { PluginData, DocumentState, ParagraphBlock } from "../types";
import { MarkdownParser, TextSimilarity } from "../parser";
import { ZettelManager } from "../zettelManager";
import { ZettelSuggestModal } from "./ZettelSuggestModal";
import { getTomorrowString } from "../sm2";

export class ReadingModal extends Modal {
  private fileStack: TFile[] = [];
  private currentFile: TFile;
  private paragraphs: ParagraphBlock[] = [];
  private footnotes: Record<string, string> = {};
  private currentIdx = 0;
  private zettelManager: ZettelManager;

  constructor(
    app: App,
    initialFile: TFile,
    private data: PluginData,
    private onSaveData: () => Promise<void>,
  ) {
    super(app);
    this.currentFile = initialFile;
    this.fileStack = [initialFile];
    this.zettelManager = new ZettelManager(app);
  }

  async onOpen() {
    this.modalEl.addClass("microreader-zen-modal");
    await this.loadFile(this.currentFile);
  }

  private async loadFile(file: TFile) {
    this.currentFile = file;
    const content = await this.app.vault.read(file);
    const parsed = MarkdownParser.parse(content);
    this.paragraphs = parsed.paragraphs;
    this.footnotes = parsed.footnotes;

    // Recupera estado salvo do documento
    let docState = this.data.documents[file.path];
    if (!docState) {
      docState = {
        filePath: file.path,
        title: file.basename,
        currentParagraphIndex: 0,
        completedParagraphs: [],
        ignoredParagraphs: [],
        totalParagraphs: this.paragraphs.length,
        lastReadAt: new Date().toISOString(),
      };
      this.data.documents[file.path] = docState;
    } else {
      docState.totalParagraphs = this.paragraphs.length;
    }

    // Acha o próximo parágrafo não concluído e não ignorado
    this.currentIdx = docState.currentParagraphIndex;
    while (
      this.currentIdx < this.paragraphs.length &&
      (docState.completedParagraphs.includes(this.currentIdx) ||
        docState.ignoredParagraphs.includes(this.currentIdx))
    ) {
      this.currentIdx++;
    }

    this.renderParagraphView();
  }

  private renderParagraphView() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("microreader-reading-container");

    const docState = this.data.documents[this.currentFile.path];

    // Se já terminou todos os parágrafos deste arquivo
    if (this.currentIdx >= this.paragraphs.length) {
      if (this.fileStack.length > 1) {
        // Desempilha da leitura recursiva
        this.fileStack.pop();
        const parentFile = this.fileStack[this.fileStack.length - 1];
        new Notice(`Retornando à nota principal: ${parentFile.basename}`);
        this.loadFile(parentFile);
        return;
      } else {
        contentEl.createEl("h2", { text: "🏆 Leitura Concluída!" });
        contentEl.createEl("p", {
          text: `Você analisou e reescreveu todos os parágrafos de "${this.currentFile.basename}".`,
        });
        const closeBtn = contentEl.createEl("button", {
          text: "Fechar",
          cls: "mod-cta",
        });
        closeBtn.onclick = () => this.close();
        return;
      }
    }

    const currentParagraph = this.paragraphs[this.currentIdx];

    // Barra de Navegação Superior
    const navBar = contentEl.createDiv({ cls: "microreader-navbar" });
    const titleEl = navBar.createEl("h3", {
      text: `📖 ${this.currentFile.basename}`,
    });
    if (this.fileStack.length > 1) {
      navBar.createEl("span", {
        text: ` (Nível ${this.fileStack.length} da Pilha Recursiva)`,
        cls: "microreader-stack-level",
      });
    }

    const progressText = navBar.createEl("span", {
      text: `Parágrafo ${this.currentIdx + 1} de ${this.paragraphs.length} (Bloco ${currentParagraph.section})`,
      cls: "microreader-progress-label",
    });

    // Barra de Progresso
    const progressContainer = contentEl.createDiv({
      cls: "microreader-progressbar-bg",
    });
    const progressBar = progressContainer.createDiv({
      cls: "microreader-progressbar-fill",
    });
    const pct = Math.round((this.currentIdx / this.paragraphs.length) * 100);
    progressBar.style.width = `${pct}%`;

    // Box do Parágrafo em Foco com Tipografia Ampla
    const paragraphCard = contentEl.createDiv({
      cls: "microreader-focus-card",
    });
    const pTextEl = paragraphCard.createDiv({
      cls: "microreader-paragraph-text",
    });
    this.renderParagraphWithFootnotes(pTextEl, currentParagraph.text);

    // Links Internos [[x]] se houver no parágrafo
    if (currentParagraph.internalLinks.length > 0) {
      const linkBox = paragraphCard.createDiv({
        cls: "microreader-internal-links-box",
      });
      linkBox.createEl("span", { text: "🔗 Aprofundar Leitura Recursiva: " });
      for (const linkName of currentParagraph.internalLinks) {
        const linkBtn = linkBox.createEl("button", {
          text: `[[${linkName}]]`,
          cls: "microreader-link-button",
        });
        linkBtn.onclick = async () => {
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(
            linkName,
            this.currentFile.path,
          );
          if (targetFile instanceof TFile) {
            if (
              this.zettelManager.hasZettelTag(
                targetFile,
                this.data.settings.requiredTag,
              )
            ) {
              this.fileStack.push(targetFile);
              await this.loadFile(targetFile);
            } else {
              new Notice(
                `A nota [[${linkName}]] não possui a tag #${this.data.settings.requiredTag}`,
              );
            }
          } else {
            new Notice(`Nota não encontrada: [[${linkName}]]`);
          }
        };
      }
    }

    // Formulário de Reescrita Zettelkasten
    const formCard = contentEl.createDiv({ cls: "microreader-form-card" });

    // Barra de Ferramentas de Reescrita & Desmembramento
    const toolsRow = formCard.createDiv({ cls: "microreader-tools-row" });
    toolsRow.createEl("label", {
      text: "Sua Síntese Atômica (Use '---' para desmembrar em múltiplas notas):",
      cls: "microreader-field-label",
    });

    const btnSplitSelection = toolsRow.createEl("button", {
      text: "✂️ Desmembrar Seleção (Inserir '---')",
      cls: "microreader-btn-tool",
    });
    setTooltip(
      btnSplitSelection,
      "Insere um delimitador '---' em volta do texto selecionado para criar notas Zettel separadas",
    );

    const textarea = formCard.createEl("textarea", {
      placeholder:
        "Digite sua síntese... Para criar duas ou mais notas atômicas independentes, separe os trechos com '---'.",
      cls: "microreader-textarea",
    });

    // Container dinâmico para os títulos das notas geradas
    const titlesContainer = formCard.createDiv({
      cls: "microreader-titles-container",
    });

    // Função que divide o texto em seções usando '---'
    const getSections = (): string[] => {
      const val = textarea.value;
      return val
        .split(/\n\s*---\s*\n|(?:\r?\n)?---\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    let titleInputs: HTMLInputElement[] = [];

    const updateTitleFields = () => {
      const sections = getSections();
      const count = Math.max(1, sections.length);

      // Se a quantidade de campos mudou, reconstrói os inputs preservando os textos já digitados
      if (titleInputs.length !== count) {
        const oldValues = titleInputs.map((input) => input.value);
        titlesContainer.empty();
        titleInputs = [];

        if (count === 1) {
          titlesContainer.createEl("label", {
            text: "Defina o Título da Nota Zettelkasten:",
            cls: "microreader-field-label",
          });
          const inp = titlesContainer.createEl("input", {
            type: "text",
            placeholder: "ex: [[Princípio da Repetição Espaçada]]",
            cls: "microreader-title-input",
          });
          inp.value = oldValues[0] || "";
          inp.oninput = validate;
          titleInputs.push(inp);
        } else {
          titlesContainer.createEl("label", {
            text: `✂️ Notas Desmembradas (${count} notas atômicas serão criadas):`,
            cls: "microreader-field-label microreader-highlight-text",
          });

          for (let i = 0; i < count; i++) {
            const row = titlesContainer.createDiv({
              cls: "microreader-multi-title-row",
            });
            row.createEl("span", {
              text: `Nota #${i + 1}:`,
              cls: "microreader-badge-num",
            });
            const inp = row.createEl("input", {
              type: "text",
              placeholder: `ex: [[Título da Ideia ${i + 1}]]`,
              cls: "microreader-title-input",
            });
            inp.value = oldValues[i] || "";
            inp.oninput = validate;
            titleInputs.push(inp);
          }
        }
      }
    };

    btnSplitSelection.onclick = () => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (start !== end) {
        const before = val.substring(0, start).trimEnd();
        const selected = val.substring(start, end).trim();
        const after = val.substring(end).trimStart();

        let newContent = "";
        if (before) newContent += before + "\n\n---\n\n";
        newContent += selected;
        if (after) newContent += "\n\n---\n\n" + after;

        textarea.value = newContent;
      } else {
        // Se nada estiver selecionado, insere o delimitador na posição do cursor
        const before = val.substring(0, start).trimEnd();
        const after = val.substring(start).trimStart();
        textarea.value = (before ? before + "\n\n---\n\n" : "---\n\n") + after;
      }

      updateTitleFields();
      validate();
      textarea.focus();
    };

    // Linha de Ações
    const actionRow = formCard.createDiv({ cls: "microreader-action-row" });

    // Botão Ignorar
    const btnIgnore = actionRow.createEl("button", {
      text: "🗑️ Ignorar Parágrafo",
      cls: "microreader-btn-danger",
    });
    setTooltip(
      btnIgnore,
      "Descarta este parágrafo sem criar revisão nem nota Zettel",
    );
    btnIgnore.onclick = async () => {
      docState.ignoredParagraphs.push(this.currentIdx);
      docState.currentParagraphIndex = this.currentIdx + 1;
      await this.onSaveData();
      this.currentIdx++;
      this.renderParagraphView();
    };

    // Botão Mesclar com Nota Existente
    const btnMerge = actionRow.createEl("button", {
      text: "🔗 Mesclar com Nota Existente",
      cls: "microreader-btn-merge",
    });
    setTooltip(
      btnMerge,
      "Anexa esta síntese a uma nota com #zettel já existente no Vault",
    );
    btnMerge.onclick = () => {
      const zettelFiles = this.zettelManager.getAllZettelFiles(
        this.data.settings.requiredTag,
      );
      new ZettelSuggestModal(this.app, zettelFiles, async (chosen) => {
        const text = textarea.value.trim();
        if (text.split(/\s+/).length < this.data.settings.minRewriteWords) {
          new Notice(
            `Escreva ao menos ${this.data.settings.minRewriteWords} palavras antes de mesclar.`,
          );
          return;
        }

        // Anexa na nota existente
        await this.zettelManager.mergeWithExistingZettel(
          chosen,
          text,
          this.currentFile,
        );
        // Substitui parágrafo no arquivo original
        await this.zettelManager.replaceParagraphWithLink(
          this.currentFile,
          currentParagraph.text,
          chosen.basename,
        );

        await this.scheduleReviewAndAdvance(
          [chosen.basename],
          currentParagraph,
          [text],
        );
      }).open();
    };

    const statusLabel = actionRow.createEl("span", {
      cls: "microreader-status-label",
    });

    // Botão Criar Nota e Avançar
    const btnSubmit = actionRow.createEl("button", {
      text: "Criar Nota(s) Zettel e Avançar (Ctrl+Enter)",
      cls: "mod-cta",
    });
    btnSubmit.disabled = true;

    const validate = () => {
      let hasHighSimilarity = false;
      let maxFoundSimilarity = 0;

      const sections = getSections();
      const count = Math.max(1, sections.length);
      const totalWords = textarea.value
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      for (const section of sections) {
        const similarity = TextSimilarity.calculateSimilarityPercent(
          currentParagraph.text,
          textarea.value,
        );
        if (similarity > maxFoundSimilarity) {
          maxFoundSimilarity = similarity;
        }
        if (similarity > this.data.settings.maxSimilarityPercent) {
          hasHighSimilarity = true;
        }
      }

      if (hasHighSimilarity) {
        btnSubmit.disabled = true;
        statusLabel.setText(
          `⚠️ Muito parecido com o original (${maxFoundSimilarity}% de similaridade, máx. ${this.data.settings.maxSimilarityPercent}%)`,
        );
        statusLabel.addClass("is-error");
      } else {
        if (totalWords < this.data.settings.minRewriteWords) {
          statusLabel.setText(
            `Mínimo de ${this.data.settings.minRewriteWords} palavras (${totalWords}/${this.data.settings.minRewriteWords})`,
          );
          btnSubmit.disabled = true;
          return false;
        }

        for (let i = 0; i < count; i++) {
          const inp = titleInputs[i];
          if (!inp || inp.value.trim().length < 2) {
            statusLabel.setText(`⚠️ Defina o título da Nota #${i + 1}`);
            btnSubmit.disabled = true;
            return false;
          }
        }

        const noteStr = count > 1 ? `${count} notas desmembradas` : "1 nota";
        statusLabel.setText(
          `✓ Pronto para criar ${noteStr} (${totalWords} palavras)`,
        );
        btnSubmit.disabled = false;
        return true;
      }
    };

    textarea.oninput = () => {
      updateTitleFields();
      validate();
    };

    // Inicializa campos de títulos
    updateTitleFields();

    const doSubmit = async () => {
      if (!validate()) return;
      const sections = getSections();
      const titles = titleInputs.map((inp) => inp.value.trim());

      // 1. Cria cada uma das notas atômicas no cofre
      for (let i = 0; i < sections.length; i++) {
        await this.zettelManager.createZettelNote(
          titles[i],
          sections[i],
          this.currentFile,
          this.data.settings.requiredTag,
        );
      }

      // 2. Substitui no arquivo de origem pelos links de todas as notas criadas: [[Nota 1]] [[Nota 2]]
      await this.zettelManager.replaceParagraphWithLinks(
        this.currentFile,
        currentParagraph.text,
        titles,
      );

      // 3. Agenda revisões SM-2 para cada nota desmembrada e avança
      await this.scheduleReviewAndAdvance(titles, currentParagraph, sections);
    };

    btnSubmit.onclick = doSubmit;

    textarea.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        doSubmit();
      }
    };

    setTimeout(() => textarea.focus(), 50);
  }

  private async scheduleReviewAndAdvance(
    zettelTitles: string[],
    block: ParagraphBlock,
    rewrittenSections: string[],
  ) {
    const docState = this.data.documents[this.currentFile.path];

    // Registra uma revisão SM-2 para cada nota desmembrada
    for (let i = 0; i < zettelTitles.length; i++) {
      const zTitle = zettelTitles[i].replace(/^\[\[|\]\]$/g, "").trim();
      const content = rewrittenSections[i] || rewrittenSections[0];

      this.data.reviews.push({
        id: `${this.currentFile.path}#${block.index}#${i}#${Date.now()}`,
        sourceFilePath: this.currentFile.path,
        paragraphIndex: block.index,
        originalText: block.text,
        rewrittenText: content,
        zettelTitle: zTitle,
        repetitionNumber: 0,
        intervalDays: 1,
        easinessFactor: 2.5,
        dueDate: getTomorrowString(),
      });
    }

    docState.completedParagraphs.push(this.currentIdx);
    docState.currentParagraphIndex = this.currentIdx + 1;
    docState.lastReadAt = new Date().toISOString();

    await this.onSaveData();

    this.currentIdx++;
    this.renderParagraphView();
  }

  /**
   * Renderiza o parágrafo convertendo [^1] em badges com tooltip nativo do Obsidian
   */
  private renderParagraphWithFootnotes(container: HTMLElement, text: string) {
    const fnRegex = /\[\^([^\]]+)\]/g;
    let lastIdx = 0;
    let match;

    while ((match = fnRegex.exec(text)) !== null) {
      // Texto antes da nota
      const before = text.substring(lastIdx, match.index);
      if (before) container.appendText(before);

      const fnId = match[1];
      const fnBadge = container.createEl("span", {
        text: `[${fnId}]`,
        cls: "microreader-footnote-badge",
      });

      const noteText = this.footnotes[fnId] || "Nota de rodapé não encontrada";
      setTooltip(fnBadge, `🔍 Nota de Rodapé: ${noteText}`);

      lastIdx = match.index + match[0].length;
    }

    const rest = text.substring(lastIdx);
    if (rest) container.appendText(rest);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
