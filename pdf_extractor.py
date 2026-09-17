import re
import fitz  # PyMuPDF
from typing import List, Tuple

def clean_text(text: str) -> str:
    """Normaliza espaçamentos e hifenizações comuns de fim de linha."""
    # Corrige quebras hifenizadas (ex: "pro- \ncesso" -> "processo")
    text = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', text)
    # Substitui quebras de linha simples por espaço
    text = re.sub(r'\n+', ' ', text)
    # Normaliza múltiplos espaços
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def extract_paragraphs_from_pdf(pdf_path: str, min_length: int = 40) -> List[Tuple[int, int, str]]:
    """
    Extrai blocos de texto do PDF utilizando PyMuPDF, agrupando-os semanticamente em parágrafos.
    Retorna uma lista de tuplas: (idx_global, page_number, texto_paragrafo)
    """
    doc = fitz.open(pdf_path)
    paragraphs = []
    global_idx = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        # Obter blocos de texto com informações de layout
        # tipo 0 = bloco de texto
        blocks = page.get_text("blocks")
        
        for b in blocks:
            if len(b) < 5 or b[6] != 0: # b[6] é o block type (0 = text)
                continue
            
            raw_text = b[4]
            # Divide blocos caso contenham quebras duplas de parágrafo
            raw_paragraphs = re.split(r'\n\s*\n', raw_text)
            
            for p_text in raw_paragraphs:
                cleaned = clean_text(p_text)
                # Ignora cabeçalhos/rodapés muito curtos ou números soltos de página
                if len(cleaned) >= min_length:
                    paragraphs.append((global_idx, page_num + 1, cleaned))
                    global_idx += 1

    return paragraphs
