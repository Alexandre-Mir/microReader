import { App, Modal, Notice, setTooltip, TFile } from "obsidian";
import { ReviewItem, PluginData } from "../types";
import { SM2Engine, getTodayString } from "../sm2";
import { ZettelFooterParser, ZettelSplit, TextSimilarity } from "../parser";

export class ReviewModal extends Modal {
  private currentIdx = 0;
  private pendingReviews: ReviewItem[] = [];
  private currentZettelFile: TFile | null = null;
  private currentSplit: ZettelSplit | null = null;

  constructor(
    app: App,
    private data: PluginData,
    private onSaveData: () => Promise<void>,
    private onCompletedAll: () => void,
  ) {
    super(app);
    this.pendingReviews = SM2Engine.getPendingReviews(this.data);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("microreader-modal");

    if (this.pendingReviews.length === 0) {
      contentEl.createEl("h2", { text: "🎉 Nenhuma revisão pendente!" });
      contentEl.createEl("p", {
        text: "Sua fila diária está limpa. Você pode prosseguir com as leituras novas.",
      });
      const btn = contentEl.createEl("button", {
        text: "Iniciar Leitura",
        cls: "mod-cta",
      });
      btn.onclick = () => {
        this.close();
        this.onCompletedAll();
      };
      return;
    }

    this.renderCurrentReview();
  }

  private async resolveAndLoadZettel(item: ReviewItem): Promise<boolean> {
    const file = this.app.metadataCache.getFirstLinkpathDest(item.zettelTitle, "");
    if (!(file instanceof TFile)) {
      this.currentZettelFile = null;
      this.currentSplit = null;
      return false;
    }
    const content = await this.app.vault.read(file);
    this.currentZettelFile = file;
    this.currentSplit = ZettelFooterParser.split(content);
    return true;
  }

  private renderCurrentReview() {
    const { contentEl } = this;
    contentEl.empty();

    const item = this.pendingReviews[this.currentIdx];
    const total = this.pendingReviews.length;

    this.resolveAndLoadZettel(item)
      .then((found) => {
        if (!found) {
          this.renderNotFoundState(item);
        } else {
          this.renderReviewForm(item, total);
        }
      })
      .catch((err) => {
        console.error("[microReader] Erro ao carregar Zettel para revisão:", err);
        this.renderNotFoundState(item);
      });
  }

  private renderNotFoundState(item: ReviewItem) {
    const { contentEl } = this;
    contentEl.empty();
    const card = contentEl.createDiv({ cls: "microreader-card" });
    card.createEl("h3", { text: `⚠️ Zettel não encontrado` });
    card.createEl("p", {
      text: `O arquivo "${item.zettelTitle}" não foi localizado no cofre (pode ter sido renomeado ou excluído).`,
    });

    const btnRow = card.createDiv({ cls: "microreader-action-row" });

    const btnRemove = btnRow.createEl("button", { text: "🗑️ Remover da Fila", cls: "microreader-btn-danger" });
    btnRemove.onclick = async () => {
      try {
        this.data.reviews = this.data.reviews.filter((r) => r.id !== item.id);
        await this.onSaveData();
        new Notice(`Item "${item.zettelTitle}" removido da fila.`);
        this.advanceToNext();
      } catch (err: any) {
        new Notice(`Erro ao remover: ${err?.message || err}`);
      }
    };

    const btnSkip = btnRow.createEl("button", { text: "⏭️ Pular", cls: "microreader-btn-merge" });
    btnSkip.onclick = () => {
      new Notice("Item pulado nesta sessão.");
      this.advanceToNext();
    };
  }

  private renderReviewForm(item: ReviewItem, total: number) {
    const { contentEl } = this;
    contentEl.empty();

    if (!Array.isArray(item.rewriteHistory)) {
      item.rewriteHistory = [];
    }

    const alertBox = contentEl.createDiv({ cls: "microreader-gatekeeper-banner" });
    alertBox.createEl("span", {
      text: `⚠️ Gatekeeper Ativo: Revisão ${this.currentIdx + 1} de ${total}.`,
    });

    const card = contentEl.createDiv({ cls: "microreader-card" });
    card.createEl("h3", { text: `Nota: [[${item.zettelTitle}]]`, cls: "microreader-title" });

    if (item.resetCount > 0) {
      card.createEl("div", {
        text: `🩸 Já resetou ${item.resetCount}x. Com ${this.data.settings.leechThreshold}x vira leech.`,
        cls: "microreader-leech-warning",
      });
    }

    card.createEl("label", { text: "Texto Original (fonte, somente leitura):" });
    const origBox = card.createDiv({ cls: "microreader-display-box" });
    origBox.setText(item.originalText);

    card.createEl("label", { text: "Sua Reescrita (edite livremente):" });
    const textarea = card.createEl("textarea", { cls: "microreader-textarea" });
    const originalBody = this.currentSplit ? this.currentSplit.body : item.rewrittenText;
    textarea.value = originalBody;

    const statusLabel = card.createEl("span", {
      cls: "microreader-status-label",
    });

    const ratingContainer = card.createDiv({ cls: "microreader-ratings-row" });
    const btnUp = ratingContainer.createEl("button", { text: "🔺 +Prioridade (não lembrei bem)", cls: "mr-btn-up" });
    const btnDown = ratingContainer.createEl("button", { text: "🔻 -Prioridade (lembrei bem)", cls: "mr-btn-down" });
    setTooltip(btnUp, "Aumenta a prioridade/frequência desta nota (atalho: Alt+1)");
    setTooltip(btnDown, "Diminui a frequência pois você lembrou bem (atalho: Alt+2)");

    const validate = (showFeedback = false): boolean => {
      const trimmedNew = (textarea.value || "").trim();
      const trimmedOld = (originalBody || "").trim();

      // Se o texto não foi alterado, permite avaliar normalmente sem validação de similaridade
      if (trimmedNew === trimmedOld) {
        btnUp.removeClass("is-disabled");
        btnDown.removeClass("is-disabled");
        statusLabel.setText("");
        statusLabel.removeClass("is-error");
        return true;
      }

      // Se foi alterado, calcula a similaridade com o texto original da nota
      const similarity = TextSimilarity.calculateSimilarityPercent(originalBody, textarea.value);
      const maxSimilarity = this.data.settings.maxSimilarityPercent;

      if (similarity > maxSimilarity) {
        btnUp.addClass("is-disabled");
        btnDown.addClass("is-disabled");
        statusLabel.setText(
          `⚠️ Muito parecido com o texto anterior (${similarity}% de similaridade, máx. ${maxSimilarity}%)`,
        );
        statusLabel.addClass("is-error");
        if (showFeedback) {
          new Notice(
            `⚠️ O texto reescrito é muito parecido com o anterior (${similarity}% de similaridade). Reescreva com mais profundidade ou mantenha o texto original.`,
          );
          textarea.focus();
        }
        return false;
      }

      btnUp.removeClass("is-disabled");
      btnDown.removeClass("is-disabled");
      statusLabel.setText(`✓ Reescrita válida (${similarity}% de similaridade)`);
      statusLabel.removeClass("is-error");
      return true;
    };

    textarea.oninput = () => {
      validate(false);
    };

    // Validação inicial
    validate(false);

    btnUp.onclick = () => {
      if (!validate(true)) return;
      this.handleRate(item, "up", textarea.value, originalBody);
    };

    btnDown.onclick = () => {
      if (!validate(true)) return;
      this.handleRate(item, "down", textarea.value, originalBody);
    };

    textarea.onkeydown = (e) => {
      if (e.altKey && e.key === "1") {
        e.preventDefault();
        if (!validate(true)) return;
        this.handleRate(item, "up", textarea.value, originalBody);
      } else if (e.altKey && e.key === "2") {
        e.preventDefault();
        if (!validate(true)) return;
        this.handleRate(item, "down", textarea.value, originalBody);
      }
    };

    setTimeout(() => textarea.focus(), 50);
  }

  private async handleRate(
    item: ReviewItem,
    direction: "up" | "down",
    newBody: string,
    oldBody: string
  ) {
    try {
      if (!Array.isArray(item.rewriteHistory)) {
        item.rewriteHistory = [];
      }

      const trimmedNew = (newBody || "").trim();
      const trimmedOld = (oldBody || "").trim();

      if (trimmedNew !== trimmedOld) {
        const similarity = TextSimilarity.calculateSimilarityPercent(oldBody, newBody);
        const maxSimilarity = this.data.settings.maxSimilarityPercent;
        if (similarity > maxSimilarity) {
          new Notice(
            `⚠️ Reescrita bloqueada: muito similar à anterior (${similarity}%).`,
          );
          return;
        }

        item.rewriteHistory.push({
          date: new Date().toISOString(),
          text: trimmedOld,
        });

        if (this.currentZettelFile && this.currentSplit) {
          const fullContent = ZettelFooterParser.join(trimmedNew, this.currentSplit.footer);
          await this.app.vault.modify(this.currentZettelFile, fullContent);
        }
      }

      const leechThreshold = this.data.settings.leechThreshold || 3;
      const updated = SM2Engine.processIncrementalReview(item, direction, leechThreshold);

      const idx = this.data.reviews.findIndex((r) => r.id === item.id);
      if (idx !== -1) {
        this.data.reviews[idx] = { ...updated, rewriteHistory: item.rewriteHistory };
      }

      if (updated.isLeech && !item.isLeech) {
        new Notice(`🩸 "${item.zettelTitle}" virou leech (${updated.resetCount} resets).`);
      }

      const today = getTodayString();
      this.data.dailyStats[today] = (this.data.dailyStats[today] || 0) + 1;
      await this.onSaveData();

      this.advanceToNext();
    } catch (err: any) {
      console.error("[microReader] Erro ao registrar revisão:", err);
      new Notice(`Erro ao registrar revisão: ${err?.message || err}`);
    }
  }

  private advanceToNext() {
    this.currentIdx++;
    if (this.currentIdx < this.pendingReviews.length) {
      this.renderCurrentReview();
    } else {
      new Notice("✅ Revisões do dia concluídas! Leitura destravada.");
      this.close();
      this.onCompletedAll();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
