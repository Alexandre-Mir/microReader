import os
import sys
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QTextEdit, QPushButton, QFileDialog, QMessageBox,
    QStackedWidget, QProgressBar, QFrame, QSpinBox
)
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QFont, QKeyEvent, QIcon

from database import Database
from markdown_extractor import extract_paragraphs_from_markdown

DARK_THEME_QSS = """
QMainWindow, QWidget {
    background-color: #121214;
    color: #E1E1E6;
    font-family: 'Segoe UI', Inter, Roboto, sans-serif;
    font-size: 14px;
}

QFrame#card {
    background-color: #202024;
    border-radius: 8px;
    padding: 16px;
    border: 1px solid #29292E;
}

QFrame#bannerAlert {
    background-color: #321f28;
    border: 1px solid #7d2442;
    border-radius: 6px;
    padding: 10px;
}

QLabel#titleLabel {
    font-size: 20px;
    font-weight: 600;
    color: #FFFFFF;
}

QLabel#sectionTitle {
    font-size: 15px;
    font-weight: 600;
    color: #04D361;
}

QLabel#paragraphDisplay {
    font-size: 17px;
    line-height: 1.6;
    color: #C4C4CC;
    padding: 8px;
    background-color: #121214;
    border-radius: 6px;
    border: 1px solid #29292E;
}

QTextEdit {
    background-color: #121214;
    color: #F4F4F5;
    border: 1px solid #323238;
    border-radius: 6px;
    padding: 10px;
    font-size: 15px;
    selection-background-color: #8257E5;
}

QTextEdit:focus {
    border: 1px solid #8257E5;
}

QPushButton {
    background-color: #8257E5;
    color: #FFFFFF;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: 6px;
    border: none;
}

QPushButton:hover {
    background-color: #9466FF;
}

QPushButton:disabled {
    background-color: #323238;
    color: #7C7C8A;
}

QPushButton#btnSecondary {
    background-color: #29292E;
    color: #E1E1E6;
}

QPushButton#btnSecondary:hover {
    background-color: #323238;
}

QPushButton#btnDanger {
    background-color: #3a1d25;
    color: #f75a68;
    border: 1px solid #7d2442;
}

QPushButton#btnDanger:hover {
    background-color: #551d2c;
    color: #ffffff;
}

QPushButton#btnQuality0 { background-color: #E53935; }
QPushButton#btnQuality1 { background-color: #FB8C00; }
QPushButton#btnQuality2 { background-color: #FDD835; color: #121214; }
QPushButton#btnQuality3 { background-color: #43A047; }
QPushButton#btnQuality4 { background-color: #1E88E5; }
QPushButton#btnQuality5 { background-color: #8E24AA; }

QProgressBar {
    background-color: #29292E;
    border-radius: 4px;
    text-align: center;
    color: #E1E1E6;
    height: 14px;
}

QProgressBar::chunk {
    background-color: #04D361;
    border-radius: 4px;
}

QToolTip {
    background-color: #1f1d2b;
    color: #F4F4F5;
    border: 1px solid #7c3aed;
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
    font-family: 'Segoe UI', Inter, sans-serif;
}
"""

class RewriteTextEdit(QTextEdit):
    """TextEdit customizado que envia o formulário com Ctrl+Enter ou Cmd+Enter."""
    def __init__(self, submit_callback, parent=None):
        super().__init__(parent)
        self.submit_callback = submit_callback

    def keyPressEvent(self, event: QKeyEvent):
        if (event.key() in (Qt.Key_Return, Qt.Key_Enter)) and (event.modifiers() & (Qt.ControlModifier | Qt.MetaModifier)):
            self.submit_callback()
            event.accept()
        else:
            super().keyPressEvent(event)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("microReader — Leitura Incremental Parágrafo por Parágrafo")
        self.resize(960, 720)
        self.setStyleSheet(DARK_THEME_QSS)

        self.db = Database()
        self.current_doc_id = None
        self.current_paragraph = None
        self.pending_reviews = []
        self.current_review_idx = 0

        self.init_ui()
        self.check_gatekeeper_and_refresh()

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        root_layout = QVBoxLayout(main_widget)
        root_layout.setContentsMargins(20, 20, 20, 20)
        root_layout.setSpacing(12)

        # Barra superior com ações e status
        top_bar = QHBoxLayout()
        self.app_title = QLabel("microReader")
        self.app_title.setObjectName("titleLabel")
        top_bar.addWidget(self.app_title)

        top_bar.addStretch()

        self.lbl_daily_quota = QLabel("")
        top_bar.addWidget(self.lbl_daily_quota)

        self.btn_change_limit = QPushButton("Configurar Limite")
        self.btn_change_limit.setObjectName("btnSecondary")
        self.btn_change_limit.clicked.connect(self.prompt_change_limit)
        top_bar.addWidget(self.btn_change_limit)

        self.btn_open_doc = QPushButton("Abrir Markdown (.md)")
        self.btn_open_doc.clicked.connect(self.open_doc_dialog)
        top_bar.addWidget(self.btn_open_doc)

        root_layout.addLayout(top_bar)

        # Pilha de Telas (Stack: 0 = Modo Leitura, 1 = Modo Revisão Obrigatória, 2 = Vazio/Boas-vindas)
        self.stack = QStackedWidget()
        root_layout.addWidget(self.stack)

        self.page_welcome = self.create_welcome_page()
        self.page_review = self.create_review_page()
        self.page_reading = self.create_reading_page()

        self.stack.addWidget(self.page_welcome)  # 0
        self.stack.addWidget(self.page_review)   # 1
        self.stack.addWidget(self.page_reading)  # 2

    # --- PÁGINA 1: BOAS VINDAS / SELEÇÃO ---
    def create_welcome_page(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setAlignment(Qt.AlignCenter)

        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(16)

        welcome_label = QLabel("Nenhum arquivo Markdown selecionado ou todas as leituras concluídas.")
        welcome_label.setAlignment(Qt.AlignCenter)
        card_layout.addWidget(welcome_label)

        btn_open = QPushButton("Carregar Documento Markdown (.md) para Leitura")
        btn_open.clicked.connect(self.open_doc_dialog)
        card_layout.addWidget(btn_open)

        layout.addWidget(card)
        return widget

    # --- PÁGINA 2: REVISÃO OBRIGATÓRIA (GATEKEEPER) ---
    def create_review_page(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setSpacing(12)

        # Banner de alerta informando bloqueio
        banner = QFrame()
        banner.setObjectName("bannerAlert")
        banner_layout = QHBoxLayout(banner)
        alert_text = QLabel("⚠️ <b>Revisão Obrigatória Ativa:</b> A nova leitura está bloqueada até que as revisões agendadas do dia sejam finalizadas.")
        banner_layout.addWidget(alert_text)
        layout.addWidget(banner)

        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(12)

        self.lbl_review_progress = QLabel("Revisão 1 de 1")
        self.lbl_review_progress.setObjectName("sectionTitle")
        card_layout.addWidget(self.lbl_review_progress)

        self.lbl_review_source = QLabel("Documento: ... | Página: ...")
        self.lbl_review_source.setStyleSheet("color: #7C7C8A; font-size: 13px;")
        card_layout.addWidget(self.lbl_review_source)

        card_layout.addWidget(QLabel("<b>Texto Original do Parágrafo:</b>"))
        self.lbl_review_original = QLabel()
        self.lbl_review_original.setObjectName("paragraphDisplay")
        self.lbl_review_original.setWordWrap(True)
        self.lbl_review_original.setTextInteractionFlags(Qt.TextSelectableByMouse)
        card_layout.addWidget(self.lbl_review_original)

        card_layout.addWidget(QLabel("<b>Sua Reescrita / Anotação Anterior:</b>"))
        self.lbl_review_rewritten = QLabel()
        self.lbl_review_rewritten.setObjectName("paragraphDisplay")
        self.lbl_review_rewritten.setStyleSheet("background-color: #18181B; color: #50FA7B; border: 1px solid #44475A;")
        self.lbl_review_rewritten.setWordWrap(True)
        self.lbl_review_rewritten.setTextInteractionFlags(Qt.TextSelectableByMouse)
        card_layout.addWidget(self.lbl_review_rewritten)

        card_layout.addWidget(QLabel("Avalie sua lembrança/compreensão (SM-2):"))
        rating_layout = QHBoxLayout()

        ratings = [
            ("0: Esqueci total", 0, "btnQuality0"),
            ("1: Errei quase tudo", 1, "btnQuality1"),
            ("2: Muito difícil", 2, "btnQuality2"),
            ("3: Bom com esforço", 3, "btnQuality3"),
            ("4: Bom / Fácil", 4, "btnQuality4"),
            ("5: Perfeito", 5, "btnQuality5")
        ]

        for text, score, btn_id in ratings:
            btn = QPushButton(text)
            btn.setObjectName(btn_id)
            btn.clicked.connect(lambda checked=False, s=score: self.submit_review(s))
            rating_layout.addWidget(btn)

        card_layout.addLayout(rating_layout)
        layout.addWidget(card)
        return widget

    # --- PÁGINA 3: LEITURA INCREMENTAL (PARÁGRAFO POR PARÁGRAFO) ---
    def create_reading_page(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setSpacing(12)

        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(12)

        header_layout = QHBoxLayout()
        self.lbl_reading_doc_title = QLabel("Documento")
        self.lbl_reading_doc_title.setObjectName("sectionTitle")
        header_layout.addWidget(self.lbl_reading_doc_title)

        header_layout.addStretch()

        self.lbl_reading_progress = QLabel("Parágrafo 1 de 1 (Pág. 1)")
        header_layout.addWidget(self.lbl_reading_progress)
        card_layout.addLayout(header_layout)

        self.progress_bar = QProgressBar()
        card_layout.addWidget(self.progress_bar)

        card_layout.addWidget(QLabel("<b>Parágrafo Atual:</b>"))
        self.lbl_current_paragraph = QLabel()
        self.lbl_current_paragraph.setObjectName("paragraphDisplay")
        self.lbl_current_paragraph.setWordWrap(True)
        self.lbl_current_paragraph.setTextInteractionFlags(Qt.TextSelectableByMouse)
        card_layout.addWidget(self.lbl_current_paragraph)

        card_layout.addWidget(QLabel("<b>Reescreva este parágrafo com suas próprias palavras para avançar:</b>"))
        self.txt_rewrite = RewriteTextEdit(self.handle_submit_rewrite)
        self.txt_rewrite.setPlaceholderText("Digite aqui sua síntese ou reescrita... (Pressione Ctrl+Enter para avançar)")
        self.txt_rewrite.textChanged.connect(self.on_rewrite_text_changed)
        card_layout.addWidget(self.txt_rewrite)

        action_layout = QHBoxLayout()
        self.btn_ignore_paragraph = QPushButton("🗑️ Ignorar / Descartar Parágrafo")
        self.btn_ignore_paragraph.setObjectName("btnDanger")
        self.btn_ignore_paragraph.setToolTip("Descarta este parágrafo caso tenha sido extraído incorretamente (ex: cabeçalho, rodapé, tabela corrompida).")
        self.btn_ignore_paragraph.clicked.connect(self.handle_ignore_paragraph)
        action_layout.addWidget(self.btn_ignore_paragraph)

        action_layout.addStretch()

        self.lbl_validation_status = QLabel("")
        action_layout.addWidget(self.lbl_validation_status)

        self.btn_submit_rewrite = QPushButton("Avançar para Próximo Parágrafo (Ctrl+Enter)")
        self.btn_submit_rewrite.setEnabled(False)
        self.btn_submit_rewrite.clicked.connect(self.handle_submit_rewrite)
        action_layout.addWidget(self.btn_submit_rewrite)

        card_layout.addLayout(action_layout)
        layout.addWidget(card)
        return widget

    # --- LÓGICA DE CONTROLE E GATEKEEPER ---
    def check_gatekeeper_and_refresh(self):
        """Verifica se há revisões pendentes. Se houver, trava a leitura e força a revisão."""
        max_daily = self.db.get_max_reviews_per_day()
        completed_today = self.db.get_today_reviews_completed()
        self.lbl_daily_quota.setText(f"Revisões hoje: {completed_today}/{max_daily}")

        if self.db.has_pending_reviews():
            # Bloqueia botão de carregar outro arquivo
            self.btn_open_doc.setEnabled(False)
            self.btn_open_doc.setToolTip("Finalize as revisões pendentes antes de iniciar leituras novas.")
            self.pending_reviews = self.db.get_pending_reviews()
            self.current_review_idx = 0
            self.show_current_review_item()
            self.stack.setCurrentIndex(1) # Página de Revisão
        else:
            # Libera o modo de leitura
            self.btn_open_doc.setEnabled(True)
            self.btn_open_doc.setToolTip("")
            self.load_active_reading_or_welcome()

    def show_current_review_item(self):
        if self.current_review_idx < len(self.pending_reviews):
            item = self.pending_reviews[self.current_review_idx]
            total = len(self.pending_reviews)
            self.lbl_review_progress.setText(f"Item de Revisão {self.current_review_idx + 1} de {total}")
            self.lbl_review_source.setText(f"Documento: {item['doc_title']} | Parágrafo #{item['paragraph_idx'] + 1} (Bloco {item['page_number']})")
            self.lbl_review_original.setText(item['original_text'])
            self.lbl_review_rewritten.setText(item['rewritten_text'])
        else:
            # Sessão de revisão do dia terminada
            QMessageBox.information(self, "Revisões Concluídas!", "Parabéns! Todas as revisões pendentes do dia foram finalizadas.\nModo de nova leitura desbloqueado.")
            self.check_gatekeeper_and_refresh()

    def submit_review(self, score: int):
        if self.current_review_idx < len(self.pending_reviews):
            item = self.pending_reviews[self.current_review_idx]
            self.db.process_review_result(item['review_id'], score)
            self.current_review_idx += 1
            if self.current_review_idx < len(self.pending_reviews):
                self.show_current_review_item()
            else:
                self.check_gatekeeper_and_refresh()

    def load_active_reading_or_welcome(self):
        if not self.current_doc_id:
            # Tenta carregar o último documento aberto
            docs = self.db.list_documents()
            if docs:
                self.current_doc_id = docs[0]["id"]
            else:
                self.stack.setCurrentIndex(0) # Bem-vindo
                return

        doc = self.db.get_document(self.current_doc_id)
        if not doc:
            self.stack.setCurrentIndex(0)
            return

        self.lbl_reading_doc_title.setText(f"📖 {doc['title']}")
        paragraph = self.db.get_current_paragraph(self.current_doc_id)

        if paragraph:
            self.current_paragraph = paragraph
            total = doc["total_paragraphs"]
            current = paragraph["idx"] + 1
            self.lbl_reading_progress.setText(f"Parágrafo {current} de {total} (Bloco {paragraph['page_number']})")
            self.progress_bar.setMaximum(total)
            self.progress_bar.setValue(current - 1)
            self.lbl_current_paragraph.setText(paragraph["original_text"])
            self.txt_rewrite.clear()
            self.txt_rewrite.setFocus()
            self.stack.setCurrentIndex(2) # Tela de Leitura
        else:
            # Documento completado
            QMessageBox.information(self, "Leitura Concluída", f"Você concluiu a leitura de todos os parágrafos de:\n{doc['title']}!")
            self.stack.setCurrentIndex(0)

    def on_rewrite_text_changed(self):
        text = self.txt_rewrite.toPlainText().strip()
        words = len(text.split())
        
        # Validação: mínimo de 3 palavras e não pode ser cópia idêntica
        if self.current_paragraph:
            import re
            plain_orig = re.sub(r'<[^>]+>', '', self.current_paragraph["original_text"]).strip().lower()
            cand = text.lower()
            if cand == plain_orig:
                self.lbl_validation_status.setText("⚠️ Cópia direta não permitida. Reescreva com suas palavras.")
                self.btn_submit_rewrite.setEnabled(False)
                return

        if words < 3:
            self.lbl_validation_status.setText(f"Digite pelo menos 3 palavras ({words}/3)")
            self.btn_submit_rewrite.setEnabled(False)
        else:
            self.lbl_validation_status.setText(f"✓ Pronto para avançar ({words} palavras)")
            self.btn_submit_rewrite.setEnabled(True)

    def handle_submit_rewrite(self):
        if not self.btn_submit_rewrite.isEnabled() or not self.current_paragraph:
            return

        rewritten = self.txt_rewrite.toPlainText().strip()
        self.db.submit_paragraph_rewrite(self.current_paragraph["id"], rewritten)
        self.load_active_reading_or_welcome()

    def handle_ignore_paragraph(self):
        if not self.current_paragraph:
            return

        confirm = QMessageBox.question(
            self,
            "Descartar Parágrafo",
            "Deseja realmente ignorar este parágrafo?\nEle não fará parte das suas revisões e não precisará ser reescrito.",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )

        if confirm == QMessageBox.Yes:
            self.db.ignore_current_paragraph(self.current_paragraph["id"])
            self.load_active_reading_or_welcome()

    def open_doc_dialog(self):
        if self.db.has_pending_reviews():
            QMessageBox.warning(self, "Ação Bloqueada", "Você possui revisões pendentes! Conclua-as antes de carregar novas leituras.")
            return

        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Selecionar Documento Markdown",
            "",
            "Arquivos Markdown (*.md *.markdown *.txt);;Todos os arquivos (*.*)"
        )
        if not file_path:
            return

        try:
            paragraphs = extract_paragraphs_from_markdown(file_path)
            if not paragraphs:
                QMessageBox.warning(self, "Aviso", "Nenhum parágrafo de texto pôde ser extraído deste arquivo Markdown.")
                return

            title = os.path.basename(file_path)
            doc_id = self.db.get_or_create_document(file_path, title, paragraphs)
            self.current_doc_id = doc_id
            self.load_active_reading_or_welcome()
        except Exception as e:
            QMessageBox.critical(self, "Erro ao abrir Markdown", f"Não foi possível processar o arquivo:\n{str(e)}")

    def prompt_change_limit(self):
        current_limit = self.db.get_max_reviews_per_day()
        spin = QSpinBox()
        spin.setRange(1, 200)
        spin.setValue(current_limit)

        from PySide6.QtWidgets import QDialog, QDialogButtonBox, QLabel, QVBoxLayout
        dialog = QDialog(self)
        dialog.setWindowTitle("Limite Diário de Revisões")
        d_layout = QVBoxLayout(dialog)
        d_layout.addWidget(QLabel("Defina o número máximo de revisões por dia:"))
        d_layout.addWidget(spin)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        d_layout.addWidget(buttons)

        if dialog.exec() == QDialog.Accepted:
            self.db.set_max_reviews_per_day(spin.value())
            self.check_gatekeeper_and_refresh()

def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
