import { App, Modal, Notice, setTooltip, TFile } from "obsidian";
import { ReviewItem, PluginData } from "../types";
import { SM2Engine, getTodayString } from "../sm2";
import { ZettelFooterParser, ZettelSplit } from "../parser";

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

    // resolve de forma assíncrona, mas a UI precisa aguardar — ver nota abaixo
    this.resolveAndLoadZettel(item).then((found) => {
      if (!found) {
        this.renderNotFoundState(item);
      } else {
        this.renderReviewForm(item, total);
      }
    });
  }

  private renderNotFoundState(item: ReviewItem) {
    const { contentEl } = this;
    const card = contentEl.createDiv({ cls: "microreader-card" });
    card.createEl("h3", { text: `⚠️ Zettel não encontrado` });
    card.createEl("p", {
      text: `O arquivo "${item.zettelTitle}" foi deletado ou renomeado?`,
    });

    const btnRow = card.createDiv({ cls: "microreader-action-row" });

    const btnRemove = btnRow.createEl("button", { text: "Remover da Fila", cls: "microreader-btn-danger" });
    btnRemove.onclick = async () => {
      this.data.reviews = this.data.reviews.filter((r) => r.id !== item.id);
      await this.onSaveData();
      this.advanceToNext();
    };

    const btnSkip = btnRow.createEl("button", { text: "Pular", cls: "microreader-btn-merge" });
    btnSkip.onclick = () => this.advanceToNext();
  }

  private renderReviewForm(item: ReviewItem, total: number) {
    const { contentEl } = this;

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
    const originalBody = this.currentSplit!.body;
    textarea.value = originalBody;

    const ratingContainer = card.createDiv({ cls: "microreader-ratings-row" });
    const btnUp = ratingContainer.createEl("button", { text: "🔺 +Prioridade (não lembrei bem)", cls: "mr-btn-up" });
    const btnDown = ratingContainer.createEl("button", { text: "🔻 -Prioridade (lembrei bem)", cls: "mr-btn-down" });

    btnUp.onclick = () => this.handleRate(item, "up", textarea.value, originalBody);
    btnDown.onclick = () => this.handleRate(item, "down", textarea.value, originalBody);

    setTimeout(() => textarea.focus(), 50);
  }

  private async handleRate(
    item: ReviewItem,
    direction: "up" | "down",
    newBody: string,
    oldBody: string
  ) {
    const trimmedNew = newBody.trim();
    const trimmedOld = oldBody.trim();

    if (trimmedNew !== trimmedOld) {
      item.rewriteHistory.push({
        date: new Date().toISOString(),
        text: trimmedOld,
      });

      const fullContent = ZettelFooterParser.join(trimmedNew, this.currentSplit!.footer);
      await this.app.vault.modify(this.currentZettelFile!, fullContent);
    }

    const leechThreshold = this.data.settings.leechThreshold;
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
