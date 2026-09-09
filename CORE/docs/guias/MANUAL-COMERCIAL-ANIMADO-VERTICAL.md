# Guia Técnico: Gerador de Comerciais Animados Verticais (9:16)

Este manual documenta a técnica e o fluxo operacional para a criação de **comerciais audiovisuais em desenho animado vertical (9:16)** com tipografia cinética, foco em redes sociais (Reels, TikTok, Shorts) e controle rígido de margem de segurança (*safe area*).

---

## 🎯 1. Visão Geral

O **Gerador de Comerciais Animados Verticais** combina a potência do Gemini Omni com estilos direcionados do Studio para produzir anúncios curtos de alto engajamento. 

### Principais Pilares:
1. **Formato Nativo Mobile (`9:16`)**: Preenchimento total de tela de smartphone.
2. **Tipografia Cinética**: Palavras de alto impacto em português que surgem sincronizadas com o ritmo da cena.
3. **Respeito às Margens de Segurança (*Safe Area*)**: Evita que textos e elementos importantes fiquem cobertos por botões da interface dos aplicativos ou cortados em telas com proporções variadas.
4. **Variedade Estética**: Suporte a 2D Flat, Aquarela, Pop Art e Animação de Mascotes.

---

## 📐 2. Diretrizes de Composição e Safe Area (Margens de Segurança)

Para que a propaganda não perca legibilidade no celular:

* **Margens Laterais (15%)**: Manter textos e logotipos recuados pelo menos 15% das bordas esquerda e direita.
* **Margens Superior e Inferior (20%)**: Reservar as faixas externas para a
  barra superior e a interface social inferior. Fundo e textura podem ocupar
  essas faixas; texto, logo e ação essencial não.
* **Tipografia Curta**: No máximo 3 a 5 palavras por frame/card para garantir leitura instantânea em telas menores.

### Palavras-Chave de Controle no Prompt:
* `centered title safe area`
* `15% side margins`
* `mobile UI safe margins`
* `no text near frame edges`

---

## 🎨 3. As 4 Direções Criativas Canônicas

### Direção 1: Tech Minimalista & Neon
* **Foco:** Aplicativos, plataformas SaaS, cursos e tecnologia.
* **Estilo:** `react-audiovisual@1` com direção flat/neon explícita.
* **Visual:** Fundo escuro, linhas vetoriais brilhantes em tons neon (azul/roxo), transições fluidas.
* **Prompt Base:**
  ```text
  Propaganda animada em formato vertical 9:16 para celular. Animação 2D flat em fundo escuro com linhas e luzes neon azul e roxo. Tipografia cinética vibrante centralizada com margem de segurança com palavras gigantes em português surgindo na tela: [TEXTO]. Transições limpas e ritmo moderno.
  ```

### Direção 2: Pop Art & Cores Vibrantes
* **Foco:** Vendas, e-commerce, moda e promoções relâmpago.
* **Estilo:** `flat-2d@1`
* **Visual:** Estética Pop Art com amarelo, rosa e azul, contornos escuros destacados, adesivos e formas geométricas.
* **Prompt Base:**
  ```text
  Propaganda animada estilo Pop Art em formato vertical 9:16 para celular. Animação 2D vibrante em tons amarelo, rosa e azul com contornos pretos destacados, adesivos animados e formas geométricas saltando. Palavras gigantes em português com efeito de carimbo mantendo margem de segurança lateral surgindo na tela: [TEXTO]. Alto impacto visual e ritmo acelerado.
  ```

### Direção 3: Aquarela Suave & Storytelling
* **Foco:** Saúde, bem-estar, cosméticos, alimentos naturais e spas.
* **Estilo:** `aquarela-2d@1`
* **Visual:** Animação em aquarela com pinceladas fluidas, tons pastéis e textura de papel organicamente animada.
* **Prompt Base:**
  ```text
  Propaganda animada em aquarela 2D em formato vertical 9:16 para celular. Animação fluida de pinceladas de tinta se espalhando suavemente sobre papel texturizado, tons pastéis e terrosos. Palavras elegantes em português aparecem pintadas com pincel no centro da tela dentro da safe area: [TEXTO]. Transições orgânicas e sensação de leveza e bem-estar.
  ```

### Direção 4: Cartoon Divertido & Mascote
* **Foco:** Delivery, lanchonetes, serviços locais e produtos de consumo consciente.
* **Estilo:** `flat-2d@1` ou `cinematic-3d@1`
* **Visual:** Mascote carismático interagindo com balões de fala, quadrinhos e texto na tela.
* **Prompt Base:**
  ```text
  Propaganda animada estilo Cartoon 2D clássico e divertido em formato vertical 9:16 para celular. Personagem carismático e expressivo interagindo com balões de quadrinhos e palavras dinâmicas em português surgindo no centro da tela: [TEXTO]. Animação alegre e movimentada com margens laterais livres.
  ```

---

## 💻 4. Execução via CLI (`CORE/`)

Para gerar qualquer uma das direções acima via terminal:

```powershell
# Exemplo de geração de comercial vertical em modo Studio
npm run video -- generate `
  --mode studio `
  --style react-audiovisual@1 `
  --aspect 9:16 `
  --prompt "Propaganda animada Pop Art vertical 9:16. Canvas React com SafeArea: left 15%, right 15%, top 20%, bottom 20%. Renderize somente o texto literal solicitado, com no máximo cinco palavras..." `
  --collection comerciais-celular `
  --confirm-provider-input true
```

### Parâmetros Obrigatórios:
* `--mode studio`: Habilita a composição com estilos predefinidos.
* `--style`: Use somente um StyleSpec exposto por `npm run video -- styles`.
  Para instruções literais de layout vertical, prefira
  `react-audiovisual@1`; `vertical-social@1` não existe no catálogo atual.
* `--aspect 9:16`: Garante o formato vertical mobile.
* `--collection`: Organiza os arquivos soltos, recibos e a união final na pasta `CORE/outputs/<colecao>/`.
* `--confirm-provider-input true`: Obrigatório quando houver imagem ou vídeo
  externo, como a logo oficial usada como referência. Não é necessário em uma
  geração puramente textual.

---

## 📊 5. Estrutura dos Arquivos de Saída

Cada execução gera os ativos organizados dentro de `CORE/outputs/<colecao>/`:

```text
CORE/outputs/<colecao>/
├── videos-soltos/               # MP4 original de cada parte do comercial
│   ├── parte-001.mp4
│   └── parte-002.mp4
├── receitas/                    # Recibos JSON com metadados e prompt efetivo
│   ├── parte-001.mp4.receipt.json
│   └── comerciais-partes-juntas.assembly.receipt.json
└── videos-unidos/               # MP4 final encadeado por stream-copy
    └── comerciais-partes-juntas.mp4
```

---

## 🚀 6. Boas Práticas para Novos Desenvolvedores / Operadores

1. **Evite Prompts Extensos Demais**: Destaque de 3 a 5 palavras de ordem no prompt para que a IA consiga desenhar letras legíveis.
2. **Reaproveite a Coleção**: Use o mesmo nome em `--collection` ao criar sequências para que o CLI faça a concatenação limpa automática em `videos-unidos/`.
3. **Respeite o Protocolo Cookie-Only**: Nunca insira senhas ou chaves em prompts ou scripts; utilize o comando `npm run session` para manter a autenticação ativa.
