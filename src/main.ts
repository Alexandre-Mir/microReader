import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
} from "obsidian";
import { PluginData, MicroReaderSettings } from "./types";
import { SM2Engine } from "./sm2";
import { ZettelManager } from "./zettelManager";
import { ReadingModal } from "./views/ReadingModal";
import { ReviewModal } from "./views/ReviewModal";

const DEFAULT_SETTINGS: MicroReaderSettings = {
  maxReviewsPerDay: 20,
  minRewriteWords: 3,
  maxSimilarityPercent: 55,
  autoTagZettel: true,
  requiredTag: "zettel",
  fontSizePx: 20,
  leechThreshold: 3,
};

const DEFAULT_DATA: PluginData = {
  settings: DEFAULT_SETTINGS,
  reviews: [],
  documents: {},
  dailyStats: {},
};

export default class MicroReaderPlugin extends Plugin {
  data: PluginData = DEFAULT_DATA;
  zettelManager!: ZettelManager;

  async onload() {
    await this.loadPluginData();
    this.zettelManager = new ZettelManager(this.app);

    // Ícone no Ribbon (barra lateral)
    this.addRibbonIcon(
      "book-open",
      "microReader: Iniciar Leitura Incremental",
      () => {
        this.startIncrementalReading();
      },
    );

    // Comandos na Command Palette
    this.addCommand({
      id: "start-reading",
      name: "Iniciar Leitura Incremental da Nota Atual",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          if (!checking) {
            this.startIncrementalReading(activeFile);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "open-reviews",
      name: "Abrir Fila de Revisões Diárias (SM-2)",
      callback: () => {
        new ReviewModal(
          this.app,
          this.data,
          () => this.savePluginData(),
          () => {
            new Notice("Fila de revisões limpa!");
          },
        ).open();
      },
    });

    this.addSettingTab(new MicroReaderSettingTab(this.app, this));
  }

  async startIncrementalReading(file?: TFile) {
    // 1. Verificação do Gatekeeper: se houver revisões pendentes, força a revisão primeiro!
    if (SM2Engine.hasPendingReviews(this.data)) {
      new Notice(
        "⚠️ Gatekeeper Ativo: Complete as revisões diárias antes de iniciar nova leitura.",
      );
      new ReviewModal(
        this.app,
        this.data,
        () => this.savePluginData(),
        () => {
          // Callback ao terminar as revisões do dia: abre a leitura
          this.openReadingForFile(file);
        },
      ).open();
      return;
    }

    this.openReadingForFile(file);
  }

  private openReadingForFile(file?: TFile) {
    const targetFile = file || this.app.workspace.getActiveFile();
    if (!targetFile || targetFile.extension !== "md") {
      new Notice("Abra ou selecione uma nota Markdown para ler.");
      return;
    }

    // 2. Filtro estrito pela tag exigida (#zettel)
    if (
      !this.zettelManager.hasZettelTag(
        targetFile,
        this.data.settings.requiredTag,
      )
    ) {
      new Notice(
        `A nota "${targetFile.basename}" precisa ter a tag #${this.data.settings.requiredTag} para ser lida no microReader.`,
      );
      return;
    }

    // Abre a interface de leitura
    new ReadingModal(this.app, targetFile, this.data, () =>
      this.savePluginData(),
    ).open();
  }

  async loadPluginData() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    this.data.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      this.data.settings,
    );
  }

  async savePluginData() {
    await this.saveData(this.data);
  }
}

class MicroReaderSettingTab extends PluginSettingTab {
  plugin: MicroReaderPlugin;

  constructor(app: App, plugin: MicroReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Configurações do microReader" });

    new Setting(containerEl)
      .setName("Limite Máximo Diário de Revisões")
      .setDesc(
        "Número máximo de revisões apresentadas por dia para prevenir estafa e sobrecarga.",
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.data.settings.maxReviewsPerDay))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.data.settings.maxReviewsPerDay = num;
              await this.plugin.savePluginData();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Tag Obrigatória para Leitura")
      .setDesc(
        "Apenas notas que possuam esta tag serão consideradas pelo leitor.",
      )
      .addText((text) =>
        text
          .setValue(this.plugin.data.settings.requiredTag)
          .onChange(async (val) => {
            this.plugin.data.settings.requiredTag = val
              .replace(/^#/, "")
              .trim();
            await this.plugin.savePluginData();
          }),
      );

    new Setting(containerEl)
      .setName("Mínimo de Palavras na Reescrita")
      .setDesc(
        "Exigência mínima de elaboração ativa para poder criar a nota Zettel e avançar.",
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.data.settings.minRewriteWords))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 1) {
              this.plugin.data.settings.minRewriteWords = num;
              await this.plugin.savePluginData();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Similaridade Máxima Permitida (%)")
      .setDesc(
        "Bloqueia o avanço caso a similaridade (N-gramas) com o parágrafo original exceda esta porcentagem. Padrão: 55%.",
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.data.settings.maxSimilarityPercent))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num >= 10 && num <= 95) {
              this.plugin.data.settings.maxSimilarityPercent = num;
              await this.plugin.savePluginData();
            }
          }),
      );
  }
}
