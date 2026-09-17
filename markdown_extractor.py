import re
from typing import List, Tuple, Dict

def parse_footnotes(content: str) -> Tuple[str, Dict[str, str]]:
    """
    Identifica e extrai notas de rodapé no formato Obsidian / Pandoc:
    Ex: [^1]: Este é o texto da nota explicativa.
    
    Retorna uma tupla contendo:
    - O conteúdo principal sem as definições de rodapé
    - Um dicionário mapeando o id da nota (ex: '1') para seu conteúdo de texto
    """
    footnotes = {}
    remaining_lines = []
    
    # Regex para capturar início de definição de rodapé: [^id]: texto
    fn_start_regex = re.compile(r'^\[\^([^\]]+)\]:\s*(.*)$')
    
    lines = content.split('\n')
    current_fn_id = None
    
    for line in lines:
        match = fn_start_regex.match(line)
        if match:
            current_fn_id = match.group(1)
            footnotes[current_fn_id] = match.group(2).strip()
        elif current_fn_id and (line.startswith('    ') or line.startswith('\t')):
            # Continuação identada da nota de rodapé
            footnotes[current_fn_id] += " " + line.strip()
        else:
            current_fn_id = None
            remaining_lines.append(line)
            
    clean_main_content = '\n'.join(remaining_lines)
    return clean_main_content, footnotes

def clean_markdown_text(text: str) -> str:
    """Limpa e formata o bloco de markdown, mantendo legibilidade sem ruídos."""
    lines = [line.strip() for line in text.split('\n')]
    joined = ' '.join(l for l in lines if l)
    return joined.strip()

def inline_footnotes_into_paragraph(paragraph_text: str, footnotes_dict: Dict[str, str]) -> str:
    """
    Substitui cada chamada [^id] por uma tag HTML com atributo 'title'
    para ser exibida como tooltip nativo no Qt ao passar o mouse.
    Ex: [^1] -> <span style='color: #8257E5; font-weight: bold; text-decoration: underline;' title='Texto da nota'>[1]</span>
    """
    import html

    def replacer(match):
        fn_id = match.group(1)
        if fn_id in footnotes_dict:
            fn_body = html.escape(footnotes_dict[fn_id])
            escaped_id = html.escape(fn_id)
            # Estilo de badge/expoente clicável visualmente com tooltip
            return f"<span style='color: #a78bfa; font-weight: bold; background-color: #2e2640; padding: 1px 5px; border-radius: 4px; border: 1px solid #7c3aed;' title='{fn_body}'>[{escaped_id}]</span>"
        return match.group(0)

    # Substitui marcações [^id]
    return re.sub(r'\[\^([^\]]+)\]', replacer, paragraph_text)

def extract_paragraphs_from_markdown(md_path: str, min_length: int = 20) -> List[Tuple[int, int, str]]:
    """
    Extrai unidades de leitura (parágrafos, blocos de lista, citações, etc.) de um arquivo Markdown (.md),
    resolvendo notas de rodapé do Obsidian ([^1]) diretamente no contexto do parágrafo onde aparecem.
    
    Retorna uma lista de tuplas: (idx_global, section_or_block_number, texto_paragrafo)
    """
    with open(md_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # Normalizar quebras de linha
    content = content.replace('\r\n', '\n').replace('\r', '\n')

    # 1. Extrair e separar todas as notas de rodapé no formato Obsidian
    main_content, footnotes = parse_footnotes(content)

    # 2. Divisão por blocos separados por linhas em branco duplas
    raw_blocks = re.split(r'\n\s*\n', main_content)

    paragraphs = []
    global_idx = 0
    current_section = 1

    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        # Se for cabeçalho (# Titulo), usamos para demarcar a seção
        if block.startswith('#'):
            current_section += 1
            continue

        # Normaliza o texto do bloco
        cleaned = clean_markdown_text(block)
        
        # 3. Incorpora notas de rodapé presentes no parágrafo
        if footnotes:
            cleaned = inline_footnotes_into_paragraph(cleaned, footnotes)

        if len(cleaned) >= min_length:
            paragraphs.append((global_idx, current_section, cleaned))
            global_idx += 1

    return paragraphs
