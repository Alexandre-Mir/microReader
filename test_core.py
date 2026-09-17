import os
import unittest
from datetime import date, timedelta
from database import Database

class TestMicroReaderDB(unittest.TestCase):
    def setUp(self):
        self.test_db = "test_microreader.db"
        if os.path.exists(self.test_db):
            os.remove(self.test_db)
        self.db = Database(self.test_db)

    def tearDown(self):
        if os.path.exists(self.test_db):
            os.remove(self.test_db)

    def test_document_and_reading_flow(self):
        paragraphs = [
            (0, 1, "Primeiro parágrafo de teste com texto explicativo."),
            (1, 1, "Segundo parágrafo de teste continuando a explicação."),
            (2, 2, "Terceiro parágrafo de teste em outra página.")
        ]
        doc_id = self.db.get_or_create_document("sample.pdf", "sample.pdf", paragraphs)
        self.assertEqual(doc_id, 1)

        # Deve começar no parágrafo 0
        p0 = self.db.get_current_paragraph(doc_id)
        self.assertEqual(p0["idx"], 0)

        # Não deve haver revisões pendentes inicialmente
        self.assertFalse(self.db.has_pending_reviews())

        # Submeter reescrita do parágrafo 0
        self.db.submit_paragraph_rewrite(p0["id"], "Minha reescrita do primeiro parágrafo.")

        # O ponteiro deve avançar para o parágrafo 1
        p1 = self.db.get_current_paragraph(doc_id)
        self.assertEqual(p1["idx"], 1)

    def test_gatekeeper_and_daily_limit(self):
        paragraphs = [(0, 1, "Texto base para teste de repetição.")]
        doc_id = self.db.get_or_create_document("test.pdf", "test.pdf", paragraphs)
        p = self.db.get_current_paragraph(doc_id)
        self.db.submit_paragraph_rewrite(p["id"], "Reescrita teste.")

        # Forçar o vencimento para hoje para simular o agendamento
        today = date.today().isoformat()
        with self.db._get_connection() as conn:
            conn.execute("UPDATE reviews SET due_date = ?", (today,))
            conn.commit()

        # Gatekeeper deve detectar revisão pendente e bloquear leitura
        self.assertTrue(self.db.has_pending_reviews())
        pending = self.db.get_pending_reviews()
        self.assertEqual(len(pending), 1)

        # Processar revisão com pontuação máxima (5)
        review_id = pending[0]["review_id"]
        self.db.process_review_result(review_id, 5)

        # Deve ter sido registrado na estatística diária e liberado o gatekeeper
        self.assertEqual(self.db.get_today_reviews_completed(), 1)
        self.assertFalse(self.db.has_pending_reviews())

    def test_ignore_paragraph(self):
        paragraphs = [
            (0, 1, "Parágrafo com ruído/cabeçalho a ser ignorado."),
            (1, 1, "Parágrafo real com conteúdo útil.")
        ]
        doc_id = self.db.get_or_create_document("test_ignore.pdf", "test_ignore.pdf", paragraphs)
        p0 = self.db.get_current_paragraph(doc_id)
        self.assertEqual(p0["idx"], 0)

        # Ignora o parágrafo 0
        self.db.ignore_current_paragraph(p0["id"])

        # O próximo parágrafo deve ser o idx 1
        p1 = self.db.get_current_paragraph(doc_id)
        self.assertEqual(p1["idx"], 1)

        # Não deve haver nenhuma revisão gerada
        self.assertFalse(self.db.has_pending_reviews())
        with self.db._get_connection() as conn:
            rev_count = conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
            self.assertEqual(rev_count, 0)

    def test_markdown_extractor(self):
        from markdown_extractor import extract_paragraphs_from_markdown
        import tempfile

        md_content = """# Título do Artigo

Primeiro parágrafo de introdução explicando o tema.

Segundo parágrafo detalhando o argumento principal da leitura.

- Item de lista com informação relevante para estudo.

Terceiro parágrafo de conclusão.
"""
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as tmp:
            tmp.write(md_content)
            tmp_path = tmp.name

        try:
            extracted = extract_paragraphs_from_markdown(tmp_path, min_length=15)
            self.assertGreaterEqual(len(extracted), 3)
            # O primeiro parágrafo extraído deve conter o primeiro parágrafo
            self.assertIn("Primeiro parágrafo", extracted[0][2])
            
            # Testar inserção no banco
            doc_id = self.db.get_or_create_document(tmp_path, "artigo.md", extracted)
            p = self.db.get_current_paragraph(doc_id)
            self.assertIsNotNone(p)
            self.assertIn("Primeiro parágrafo", p["original_text"])
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_obsidian_footnotes(self):
        from markdown_extractor import extract_paragraphs_from_markdown
        import tempfile

        md_with_footnotes = """# Conceito Importante

A teoria formulada por pesquisadores[^1] revolucionou o campo da neurociência[^nota2].

Este segundo parágrafo traz novos desdobramentos sem notas de rodapé.

[^1]: Smith, John et al. (2020). Estudo pioneiro de repetição espaçada.
[^nota2]: Observação complementar sobre neuroplasticidade e memória.
"""
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False) as tmp:
            tmp.write(md_with_footnotes)
            tmp_path = tmp.name

        try:
            extracted = extract_paragraphs_from_markdown(tmp_path, min_length=15)
            # Devem ser exatamente 2 parágrafos de leitura (as notas de rodapé são integradas, não viram parágrafos soltos)
            self.assertEqual(len(extracted), 2)
            p1_text = extracted[0][2]
            
            # Verificar se os conteúdos das notas foram embutidos como tooltip (title='...') na tag span
            self.assertIn("Estudo pioneiro de repetição espaçada", p1_text)
            self.assertIn("neuroplasticidade e memória", p1_text)
            self.assertIn("<span", p1_text)
            self.assertIn("title=", p1_text)
            self.assertIn("[1]", p1_text)
            self.assertIn("[nota2]", p1_text)

            # Verificar segundo parágrafo intacto
            self.assertIn("Este segundo parágrafo", extracted[1][2])
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

if __name__ == "__main__":
    unittest.main()
