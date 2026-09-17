import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Tuple

class Database:
    def __init__(self, db_path: str = "microreader.db"):
        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # Configurações do usuário (ex: max_reviews_per_day)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)

            # Documentos importados
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    total_paragraphs INTEGER DEFAULT 0,
                    current_paragraph_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Parágrafos extraídos do documento
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS paragraphs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id INTEGER NOT NULL,
                    idx INTEGER NOT NULL,
                    page_number INTEGER NOT NULL,
                    original_text TEXT NOT NULL,
                    is_completed BOOLEAN DEFAULT 0,
                    is_ignored BOOLEAN DEFAULT 0,
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
                    UNIQUE(document_id, idx)
                )
            """)

            # Migração suave para bases já criadas
            try:
                cursor.execute("ALTER TABLE paragraphs ADD COLUMN is_ignored BOOLEAN DEFAULT 0")
            except sqlite3.OperationalError:
                pass  # Coluna já existe

            # Reescritas e itens de repetição espaçada (SM-2 / Incremental)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    paragraph_id INTEGER UNIQUE NOT NULL,
                    rewritten_text TEXT NOT NULL,
                    repetition_number INTEGER DEFAULT 0,
                    interval_days INTEGER DEFAULT 1,
                    easiness_factor REAL DEFAULT 2.5,
                    due_date DATE NOT NULL,
                    last_reviewed_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
                )
            """)

            # Registro diário de revisões realizadas (para respeitar o limite máximo diário)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS daily_stats (
                    review_date DATE PRIMARY KEY,
                    reviews_completed INTEGER DEFAULT 0
                )
            """)

            # Valor padrão para max_reviews_per_day caso não exista
            cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_reviews_per_day', '20')")
            conn.commit()

    # --- Configurações ---
    def get_setting(self, key: str, default: str = "") -> str:
        with self._get_connection() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else default

    def set_setting(self, key: str, value: str):
        with self._get_connection() as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
            conn.commit()

    def get_max_reviews_per_day(self) -> int:
        return int(self.get_setting("max_reviews_per_day", "20"))

    def set_max_reviews_per_day(self, count: int):
        self.set_setting("max_reviews_per_day", str(count))

    # --- Estatísticas Diárias ---
    def get_today_reviews_completed(self) -> int:
        today = date.today().isoformat()
        with self._get_connection() as conn:
            row = conn.execute("SELECT reviews_completed FROM daily_stats WHERE review_date = ?", (today,)).fetchone()
            return row["reviews_completed"] if row else 0

    def increment_today_reviews_completed(self):
        today = date.today().isoformat()
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO daily_stats (review_date, reviews_completed)
                VALUES (?, 1)
                ON CONFLICT(review_date) DO UPDATE SET reviews_completed = reviews_completed + 1
            """, (today,))
            conn.commit()

    # --- Gatekeeper / Fila de Revisão ---
    def get_pending_reviews(self) -> List[Dict]:
        """
        Retorna as revisões agendadas até a data atual, respeitando o limite diário configurado.
        """
        today = date.today().isoformat()
        max_daily = self.get_max_reviews_per_day()
        completed_today = self.get_today_reviews_completed()
        remaining_quota = max(0, max_daily - completed_today)

        if remaining_quota <= 0:
            return []

        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT 
                    r.id as review_id,
                    r.paragraph_id,
                    r.rewritten_text,
                    r.repetition_number,
                    r.interval_days,
                    r.easiness_factor,
                    r.due_date,
                    p.original_text,
                    p.page_number,
                    p.idx as paragraph_idx,
                    d.title as doc_title,
                    d.id as doc_id
                FROM reviews r
                JOIN paragraphs p ON r.paragraph_id = p.id
                JOIN documents d ON p.document_id = d.id
                WHERE r.due_date <= ?
                ORDER BY r.due_date ASC, r.id ASC
                LIMIT ?
            """, (today, remaining_quota))
            return [dict(row) for row in cursor.fetchall()]

    def has_pending_reviews(self) -> bool:
        """Verifica se existem revisões pendentes para hoje e se a cota do dia não foi esgotada."""
        return len(self.get_pending_reviews()) > 0

    def process_review_result(self, review_id: int, quality: int):
        """
        Aplica o algoritmo SM-2 baseado na nota de qualidade (0 a 5):
        - quality < 3: falha (reinicia repetição)
        - quality >= 3: sucesso (avança intervalo)
        """
        quality = max(0, min(5, quality))
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone()
            if not row:
                return

            rep = row["repetition_number"]
            interval = row["interval_days"]
            ef = row["easiness_factor"]

            # Atualização do Easiness Factor (EF)
            ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
            if ef < 1.3:
                ef = 1.3

            if quality < 3:
                rep = 0
                interval = 1
            else:
                if rep == 0:
                    interval = 1
                elif rep == 1:
                    interval = 6
                else:
                    interval = int(round(interval * ef))
                rep += 1

            next_due = (date.today() + timedelta(days=interval)).isoformat()
            now = datetime.now().isoformat()

            conn.execute("""
                UPDATE reviews
                SET repetition_number = ?,
                    interval_days = ?,
                    easiness_factor = ?,
                    due_date = ?,
                    last_reviewed_at = ?
                WHERE id = ?
            """, (rep, interval, ef, next_due, now, review_id))
            conn.commit()

        self.increment_today_reviews_completed()

    # --- Gestão de Documentos e Leitura Incremental ---
    def get_or_create_document(self, file_path: str, title: str, paragraphs_data: List[Tuple[int, int, str]]) -> int:
        """
        Retorna o ID do documento. Se for novo, insere o documento e todos os parágrafos.
        paragraphs_data: Lista de tuplas (idx, page_number, text)
        """
        with self._get_connection() as conn:
            row = conn.execute("SELECT id FROM documents WHERE file_path = ?", (file_path,)).fetchone()
            if row:
                doc_id = row["id"]
                conn.execute("UPDATE documents SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?", (doc_id,))
                conn.commit()
                return doc_id

            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO documents (file_path, title, total_paragraphs, current_paragraph_index)
                VALUES (?, ?, ?, 0)
            """, (file_path, title, len(paragraphs_data)))
            doc_id = cursor.lastrowid

            cursor.executemany("""
                INSERT INTO paragraphs (document_id, idx, page_number, original_text, is_completed)
                VALUES (?, ?, ?, ?, 0)
            """, [(doc_id, idx, page, text) for idx, page, text in paragraphs_data])

            conn.commit()
            return doc_id

    def list_documents(self) -> List[Dict]:
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, file_path, title, total_paragraphs, current_paragraph_index, created_at, last_opened_at
                FROM documents
                ORDER BY last_opened_at DESC
            """)
            return [dict(row) for row in cursor.fetchall()]

    def get_document(self, doc_id: int) -> Optional[Dict]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            return dict(row) if row else None

    def get_current_paragraph(self, doc_id: int) -> Optional[Dict]:
        with self._get_connection() as conn:
            doc = conn.execute("SELECT current_paragraph_index FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return None
            idx = doc["current_paragraph_index"]
            # Busca o primeiro parágrafo não concluído e não ignorado a partir do índice atual
            p = conn.execute("""
                SELECT * FROM paragraphs 
                WHERE document_id = ? AND idx >= ? AND is_completed = 0 AND is_ignored = 0
                ORDER BY idx ASC LIMIT 1
            """, (doc_id, idx)).fetchone()
            
            if p:
                # Se o índice mudou (por exemplo, pulando parágrafos já ignorados), sincroniza com documents
                if p["idx"] != idx:
                    conn.execute("UPDATE documents SET current_paragraph_index = ? WHERE id = ?", (p["idx"], doc_id))
                    conn.commit()
                return dict(p)
            return None

    def ignore_current_paragraph(self, paragraph_id: int):
        """
        Descarta o parágrafo atual (marca como is_ignored = 1) e avança
        o current_paragraph_index sem registrar revisão.
        """
        with self._get_connection() as conn:
            conn.execute("UPDATE paragraphs SET is_ignored = 1 WHERE id = ?", (paragraph_id,))
            p = conn.execute("SELECT document_id, idx FROM paragraphs WHERE id = ?", (paragraph_id,)) .fetchone()
            if p:
                doc_id = p["document_id"]
                conn.execute("""
                    UPDATE documents
                    SET current_paragraph_index = current_paragraph_index + 1
                    WHERE id = ?
                """, (doc_id,))
            conn.commit()

    def submit_paragraph_rewrite(self, paragraph_id: int, rewritten_text: str):
        """
        Salva a reescrita do parágrafo atual, agenda sua primeira revisão (amanhã)
        e avança o current_paragraph_index do documento.
        """
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        with self._get_connection() as conn:
            # 1. Marcar parágrafo como concluído
            conn.execute("UPDATE paragraphs SET is_completed = 1 WHERE id = ?", (paragraph_id,))

            # 2. Criar ou atualizar a revisão
            conn.execute("""
                INSERT INTO reviews (paragraph_id, rewritten_text, repetition_number, interval_days, easiness_factor, due_date)
                VALUES (?, ?, 0, 1, 2.5, ?)
                ON CONFLICT(paragraph_id) DO UPDATE SET rewritten_text = excluded.rewritten_text
            """, (paragraph_id, rewritten_text, tomorrow))

            # 3. Avançar o ponteiro do documento
            p = conn.execute("SELECT document_id, idx FROM paragraphs WHERE id = ?", (paragraph_id,)).fetchone()
            if p:
                doc_id = p["document_id"]
                conn.execute("""
                    UPDATE documents
                    SET current_paragraph_index = current_paragraph_index + 1
                    WHERE id = ?
                """, (doc_id,))

            conn.commit()

    def get_document_completed_paragraphs(self, doc_id: int) -> List[Dict]:
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT p.idx, p.page_number, p.original_text, r.rewritten_text, r.due_date
                FROM paragraphs p
                LEFT JOIN reviews r ON p.id = r.paragraph_id
                WHERE p.document_id = ? AND p.is_completed = 1
                ORDER BY p.idx ASC
            """, (doc_id,))
            return [dict(row) for row in cursor.fetchall()]
