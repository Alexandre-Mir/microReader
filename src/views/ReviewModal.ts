import { App, Modal, Notice, setTooltip } from "obsidian";
import { ReviewItem, PluginData } from "../types";
import { SM2Engine, getTodayString } from "../sm2";

export class ReviewModal extends Modal {
  private currentIdx = 0;
  private pendingReviews: ReviewItem[] = [];

  constructor(
    app: App,
    private data: PluginData,
    private onSaveData: () => Promise<void>,
    private onCompletedAll: () => void
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
      contentEl.createEl("p", { text: "Sua fila diária está limpa. Você pode prosseguir com as leituras novas." });
      const btn = contentEl.createEl("button", { text: "Iniciar Leitura", cls: "mod-cta" });
      btn.onclick = () => {
        this.close();
        this.onCompletedAll();
      };
      return;
    }

    this.renderCurrentReview();
  }

  private renderCurrentReview() {
    const { contentEl } = this;
    contentEl.empty();

    const item = this.pendingReviews[this.currentIdx];
    const total = this.pendingReviews.length;

    // Alerta do Gatekeeper
    const alertBox = contentEl.createDiv({ cls: "microreader-gatekeeper-banner" });
    alertBox.createEl("span", {
      text: `⚠️ Gatekeeper Ativo: Revisão ${this.currentIdx + 1} de ${total}. Conclua para liberar nova leitura.`,
    });

    const card = contentEl.createDiv({ cls: "microreader-card" });

    card.createEl("h3", { text: `Nota: [[${item.zettelTitle}]]`, cls: "microreader-title" });
    card.createEl("div", {
      text: `Origem: ${item.sourceFilePath} (Parágrafo #${item.paragraphIndex + 1})`,
      cls: "microreader-subtitle",
    });

    card.createEl("label", { text: "Texto Original:" });
    const origBox = card.createDiv({ cls: "microreader-display-box" });
    origBox.setText(item.originalText);

    card.createEl("label", { text: "Sua Reescrita / Zettelkasten:" });
    const rewriteBox = card.createDiv({ cls: "microreader-display-box microreader-highlight-box" });
    rewriteBox.setText(item.rewrittenText);

    card.createEl("p", { text: "Avalie sua retenção (SM-2):", cls: "microreader-rating-label" });

    const ratingContainer = card.createDiv({ cls: "microreader-ratings-row" });
    const ratings = [
      { score: 0, label: "0: Esqueci", cls: "mr-btn-0" },
      { score: 1, label: "1: Muito difícil", cls: "mr-btn-1" },
      { score: 2, label: "2: Difícil", cls: "mr-btn-2" },
      { score: 3, label: "3: Bom com esforço", cls: "mr-btn-3" },
      { score: 4, label: "4: Fácil", cls: "mr-btn-4" },
      { score: 5, label: "5: Perfeito", cls: "mr-btn-5" },
    ];

    for (const r of ratings) {
      const btn = ratingContainer.createEl("button", { text: r.label, cls: r.cls });
      btn.onclick = () => this.handleRate(r.score);
    }
  }

  private async handleRate(score: number) {
    const item = this.pendingReviews[this.currentIdx];
    const updated = SM2Engine.processReviewResult(item, score);

    // Atualiza no registro do plugin
    const idx = this.data.reviews.findIndex((r) => r.id === item.id);
    if (idx !== -1) {
      this.data.reviews[idx] = updated;
    }

    // Registra estatística diária
    const today = getTodayString();
    this.data.dailyStats[today] = (this.data.dailyStats[today] || 0) + 1;
    await this.onSaveData();

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
