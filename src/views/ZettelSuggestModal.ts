import { App, SuggestModal, TFile } from "obsidian";

export class ZettelSuggestModal extends SuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Pesquise uma nota com #zettel para mesclar...");
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.files.filter((f) => f.basename.toLowerCase().includes(q));
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createEl("div", { text: file.basename, cls: "microreader-suggest-title" });
    el.createEl("small", { text: file.path, cls: "microreader-suggest-path" });
  }

  onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
    this.onChoose(file);
  }
}
