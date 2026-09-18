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

  private renderCurrentReview() {
    const { contentEl } = this;
    contentEl.empty();

    const item = this.pendingReviews[this.currentIdx];
    const total = this.pendingReviews.length;

    // Alerta do Gatekeeper
    const alertBox = contentEl.createDiv({
      cls: "microreader-gatekeeper-banner",
    });
    alertBox.createEl("span", {
      text: `⚠️ Gatekeeper Ativo: Revisão ${this.currentIdx + 1} de ${total}. Conclua para liberar nova leitura.`,
    });

    const card = contentEl.createDiv({ cls: "microreader-card" });

    card.createEl("h3", {
      text: `Nota: [[${item.zettelTitle}]]`,
      cls: "microreader-title",
    });
    if (item.resetCount > 0) {
      card.createEl("div", {
        text: `🩸 Este Zettel já resetou ${item.resetCount}x. Com ${this.data.settings.leechThreshold}x vira leech e some da fila.`,
        cls: "microreader-leech-warning",
      });
    }
    card.createEl("div", {
      text: `Origem: ${item.sourceFilePath} (Parágrafo #${item.paragraphIndex + 1})`,
      cls: "microreader-subtitle",
    });

    card.createEl("label", { text: "Texto Original:" });
    const origBox = card.createDiv({ cls: "microreader-display-box" });
    origBox.setText(item.originalText);

    card.createEl("label", { text: "Sua Reescrita / Zettelkasten:" });
    const rewriteBox = card.createDiv({
      cls: "microreader-display-box microreader-highlight-box",
    });
    rewriteBox.setText(item.rewrittenText);

    card.createEl("p", {
      text: "Como foi lembrar disso?",
      cls: "microreader-rating-label",
    });

    const ratingContainer = card.createDiv({ cls: "microreader-ratings-row" });

    const btnUp = ratingContainer.createEl("button", {
      text: "🔺 +Prioridade (não lembro bem)",
      cls: "mr-btn-up",
    });
    btnUp.onclick = () => this.handleRate("up");

    const btnDown = ratingContainer.createEl("button", {
      text: "🔻 -Prioridade (lembro bem)",
      cls: "mr-btn-down",
    });
    btnDown.onclick = () => this.handleRate("down");
  }

  private async handleRate(direction: "up" | "down") {
    const item = this.pendingReviews[this.currentIdx];
    const leechThreshold = this.data.settings.leechThreshold;
    const updated = SM2Engine.processIncrementalReview(
      item,
      direction,
      leechThreshold,
    );
    // Atualiza no registro do plugin
    const idx = this.data.reviews.findIndex((r) => r.id === item.id);
    if (idx !== -1) {
      this.data.reviews[idx] = updated;
    }

    if (updated.isLeech && !item.isLeech) {
      new Notice(
        `🩸 "${item.zettelTitle}" virou um leech (${updated.resetCount} resets) e vai sumir da fila até você resolver manualmente.`,
      );
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
