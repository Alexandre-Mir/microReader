# microReader — Plugin Oficial para Obsidian

Plugin para o [Obsidian](https://obsidian.md) focado em **Leitura Incremental** (inspirado no *SuperMemo*), **Zettelkasten Progressivo** e **Active Recall** parágrafo por parágrafo.

---

## 🚀 Como Funciona

### 1. Filtro Estrito `#zettel`
- O plugin processa apenas notas Markdown que contenham a tag `#zettel` (seja no frontmatter YAML ou no corpo).
- Todas as novas notas atômicas geradas pelo plugin recebem automaticamente a tag `#zettel`.

### 2. Leitura Parágrafo por Parágrafo & Ergonomia Visual (UI/UX)
- Interface Zen com **tipografia ampla (~20px)**, entrelinha ergonômica (`line-height: 1.85`) e largura de leitura otimizada (máximo de 74 caracteres) para eliminar a fadiga ocular.
- O leitor visualiza apenas o parágrafo em foco.
- **Notas de rodapé `[^1]` como Tooltips Nativas:** badges interativos `[1]` que exibem a explicação completa instantaneamente ao passar o mouse.

### 3. Zettelkasten Progressivo
- **Criação de Nota Atômica:** O usuário define o título da nova nota (ex: `[[Princípio de Pareto]]`), escreve sua síntese com suas próprias palavras e pressiona **`Ctrl+Enter`**.
  - Uma nova nota atômica é gerada no Vault com a síntese, a tag `#zettel` e o link de volta: `**Origem:** [[Arquivo de Leitura]]`.
  - No arquivo em leitura, o parágrafo analisado é substituído pelo link `[[Princípio de Pareto]]`.
- **✂️ Desmembrar Síntese em Múltiplas Notas (`---`):**
  - Enquanto você reescreve, se perceber que o conteúdo aborda duas ou mais ideias independentes, basta separar os blocos com o delimitador `---`.
  - Você pode selecionar um trecho do texto e clicar em **`✂️ Desmembrar Seleção (Inserir '---')`**.
  - A interface detecta dinamicamente a divisão e abre campos de título para cada nota (ex: `Nota #1: [[Primeira Ideia]]`, `Nota #2: [[Segunda Ideia]]`).
  - Ao avançar, **múltiplas notas atômicas independentes com a tag `#zettel` são criadas no Vault**, o parágrafo lido é substituído pelos links de todas elas (`[[Primeira Ideia]] [[Segunda Ideia]]`), e cada uma entra individualmente no ciclo de repetição espaçada SM-2.
- **🔗 Mesclar com Nota Existente:** Se o parágrafo complementar uma ideia já estudada, um clique abre a busca com autocompletar entre suas notas `#zettel` para anexar o novo conteúdo e linkar o parágrafo.
- **Pilha de Leitura Recursiva (`[[link]]`):** Se o parágrafo contiver links internos `[[Outra Nota]]`, você pode aprofundar na leitura da nota filha e retornar automaticamente à nota original ao concluir.

### 4. Gatekeeper de Revisão Obrigatória & SM-2
- Ao abrir o leitor, se houver revisões pendentes agendadas para o dia pelo algoritmo **SM-2**, uma tela de revisão é acionada obrigatoriamente.
- O leitor avalia sua retenção (notas de 0 a 5).
- A leitura de novos parágrafos só é liberada após a conclusão da fila diária.
- **Limite Diário Configurável:** Teto diário configurável nas configurações do plugin para evitar sobrecarga.

---

## 📦 Instalação no Obsidian

1. No seu cofre do Obsidian, crie a pasta do plugin:
   ```bash
   mkdir -p "/caminho/do/seu/vault/.obsidian/plugins/obsidian-microreader"
   ```
2. Copie os três arquivos gerados para dentro da pasta:
   - `manifest.json`
   - `main.js`
   - `styles.css`
3. No Obsidian, vá em:
   - **Settings** ➔ **Community plugins** ➔ Clique no botão **Reload plugins**.
   - Ative o plugin **microReader — Zettelkasten & SuperMemo Reader**.

---

## 🛠️ Comandos Disponíveis

- **Ribbon (Barra Lateral):** Clique no ícone de livro aberto para iniciar a leitura.
- **Command Palette (`Ctrl+P` / `Cmd+P`):**
  - `microReader: Iniciar Leitura Incremental da Nota Atual`
  - `microReader: Abrir Fila de Revisões Diárias (SM-2)`
