
const CAMPOS = ["source","relPath","title","collectionId","mtimeMs","duration","isMaster","sizeMb","hasPrompt","aspect"];
let TUDO = [];
let FILTRADOS = [];
let COLECOES = [];
let FONTES = [];
let colecaoAtiva = null;
let soMasters = false;
let termo = "";
let formato = "";
let filtroColecao = "";
let autoReindexTimer = null;
let assinaturaGrade = '';
let cargaEmCurso = false;
// O prompt não cabe no payload da grade (o índice tem 26 MB), então quem procura
// por prompt pergunta ao servidor e recebe só os identificadores que casaram.
let idsPorPrompt = null;

const palco = document.getElementById("palco");
const area = document.getElementById("area");

// ---------- carregamento ----------

async function carregar(reindexar = false) {
  if (cargaEmCurso) return;
  cargaEmCurso = true;
  const emSegundoPlano = TUDO.length > 0;
  if (!emSegundoPlano) palco.innerHTML = '<div class="estado"><b>Carregando o acervo</b>Preparando a galeria.</div>';
  try {
  const [dados] = await Promise.all([
    fetch("/api/acervo" + (reindexar ? "?reindexar=1" : "")).then(resposta => {
      if (!resposta.ok) throw new Error("Acervo indisponível");
      return resposta.json();
    }),
    carregarFavoritos(),
  ]);
  const assinatura = JSON.stringify(dados.videos);
  if (assinatura === assinaturaGrade) return;
  fecharInfoCard();
  assinaturaGrade = assinatura;
  TUDO = dados.videos.map((linha) => {
    const item = {};
    (dados.campos || CAMPOS).forEach((campo, indice) => { item[campo] = linha[indice]; });
    item.colecaoCurta = item.collectionId.split("/").slice(1).join("/");
    item.busca = (item.title + " " + item.collectionId).toLowerCase();
    return item;
  });
  COLECOES = dados.collections;
  FONTES = dados.sources;
  receberGrupos(dados.groups || [], dados.tagging);
  if (videoNoLeitor) videoNoLeitor = TUDO.find(v => mesmaMidia(v, videoNoLeitor)) || videoNoLeitor;
  document.getElementById("marca-total").textContent =
    dados.stats.total.toLocaleString("pt-BR") + " vídeos · " + dados.stats.collections + " coleções";
  montarLateral();
  aplicar({ preservarPosicao: emSegundoPlano });
  } finally { cargaEmCurso = false; }
}

// ---------- lateral ----------

function montarLateral() {
  const lateral = document.getElementById("lateral");
  lateral.innerHTML = "";
  const alvo = filtroColecao.trim().toLowerCase();
  montarColecaoFavoritos(lateral);

  if (!alvo) {
    const todas = document.createElement("div");
    todas.className = "item-col" + (colecaoAtiva === null ? " ativo" : "");
    todas.innerHTML = '<span class="rotulo">Todas as coleções</span><span class="n">' + TUDO.length.toLocaleString("pt-BR") + "</span>";
    todas.onclick = () => { colecaoAtiva = null; montarLateral(); aplicar(); };
    lateral.appendChild(todas);
  }

  let achou = 0;
  for (const fonte of FONTES) {
    if (!fonte.total) continue;
    const daFonte = COLECOES.filter((item) => item.source === fonte.id && (!alvo || item.name.toLowerCase().includes(alvo)));
    if (!daFonte.length) continue;
    const cabeca = document.createElement("div");
    cabeca.className = "grupo-fonte";
    cabeca.textContent = fonte.label + " · " + fonte.total.toLocaleString("pt-BR");
    lateral.appendChild(cabeca);
    for (const colecao of daFonte) {
      achou += 1;
      const linha = document.createElement("div");
      linha.className = "item-col" + (colecaoAtiva === colecao.id ? " ativo" : "");
      linha.innerHTML = '<span class="rotulo">' + escapar(colecao.name) + '</span><span class="n">' + colecao.total + "</span>";
      linha.title = colecao.name;
      linha.onclick = () => { colecaoAtiva = colecao.id; montarLateral(); aplicar(); };
      lateral.appendChild(linha);
    }
  }
  if (alvo && !achou) {
    const vazio = document.createElement("div");
    vazio.className = "grupo-fonte";
    vazio.textContent = "nenhuma coleção com esse nome";
    lateral.appendChild(vazio);
  }
}

// ---------- filtro e ordenação ----------

function porPromptVisiveis() {
  if (!idsPorPrompt) return 0;
  return FILTRADOS.filter((v) => !v.busca.includes(termo) && idsPorPrompt.has(v.source + "/" + v.relPath)).length;
}

function aplicar({ preservarPosicao = false } = {}) {
  fecharInfoCard();
  cancelarAntecipacao();
  const ordem = document.getElementById("ordem").value;
  FILTRADOS = TUDO.filter((video) => {
    if (soFavoritos && !ehFavorito(video)) return false;
    if (!passaGrupos(video)) return false;
    if (colecaoAtiva && video.collectionId !== colecaoAtiva) return false;
    if (porId("origem").value && video.source !== porId("origem").value) return false;
    if (soMasters && video.delivery?.includeInFinals === false) return false;
    if (formato && video.aspect !== formato) return false;
    if (termo && !video.busca.includes(termo) && !(idsPorPrompt && idsPorPrompt.has(video.source + "/" + video.relPath))) return false;
    return true;
  });

  const ordenadores = {
    recentes: (a, b) => b.mtimeMs - a.mtimeMs,
    antigos: (a, b) => a.mtimeMs - b.mtimeMs,
    longos: (a, b) => (b.duration || 0) - (a.duration || 0),
    pesados: (a, b) => b.sizeMb - a.sizeMb,
    nome: (a, b) => a.title.localeCompare(b.title, "pt-BR"),
  };
  FILTRADOS.sort(ordenadores[ordem]);

  atualizarResumo();
  atualizarSelecaoGrupos();

  if (!preservarPosicao) area.scrollTop = 0;
  pararPrevia();
  observadorMedicao.disconnect();
  palco.replaceChildren();
  desenhar();
  sincronizarApresentacao();
}

// ---------- grade virtualizada ----------

let LARGURA_ALVO = 220;
const ESPACO = 10;

function desenhar() {
  if (!FILTRADOS.length) {
    palco.style.height = "auto";
    palco.innerHTML = '<div class="estado"><b>Nada aqui com esse filtro</b>Tente outro termo, ou limpe a coleção selecionada.</div>';
    return;
  }
  if (palco.querySelector(".estado")) palco.innerHTML = "";
  const layout = layoutDoAcervo();
  palco.style.height = layout.altura + 'px';
  const topo = area.scrollTop - palco.offsetTop;
  const vivos = new Set();
  const existentes = new Map([...palco.children].filter(c => c.dataset.chave).map(c => [c.dataset.chave, c]));
  for (const pos of posicoesVisiveis(layout, topo - 250, topo + area.clientHeight + 250)) {
    const video = FILTRADOS[pos.indice];
    const chave = video.source + '/' + video.relPath;
    vivos.add(chave);
    const carta = existentes.get(chave) || criarCarta(video, chave);
    atualizarBotaoFavorito(carta, video);
    carta.classList.toggle('selecionada', mesmaMidia(video, videoNoLeitor));
    carta.setAttribute('aria-pressed', String(mesmaMidia(video, videoNoLeitor)));
    carta.style.width = layout.larguraCarta + 'px';
    carta.style.height = pos.altura + 'px';
    carta.style.left = pos.x + 'px';
    carta.style.top = pos.y + 'px';
    // Insere só cartões novos: mover um vídeo existente no DOM interrompe a prévia.
    if (!existentes.has(chave)) {
      carta.dataset.indice = pos.indice;
      const seguinte = [...palco.children].find(c => c !== carta && Number(c.dataset.indice) > pos.indice);
      if (seguinte) palco.insertBefore(carta, seguinte);
    }
  }
  for (const [chave, carta] of existentes) if (!vivos.has(chave)) {
    if (carta === cartaEmPrevia) pararPrevia();
    observadorMedicao.unobserve(carta);
    carta.remove();
  }
}

function enderecoDaMidia(video) {
  return "/midia/" + video.source + "/" + video.relPath.split("/").map(encodeURIComponent).join("/") + '?v=' + encodeURIComponent(video.mtimeMs + '-' + video.sizeMb);
}

function criarCarta(video, chave) {
  const carta = document.createElement("div");
  carta.className = "carta";
  carta.dataset.chave = chave;
  carta.tabIndex = 0;
  carta.setAttribute("role", "button");
  carta.setAttribute("aria-label", "Assistir " + tituloDoCard(video));
  carta.addEventListener("keydown", (event) => {
    if (event.target !== carta) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); abrirLeitor(video); }
  });
  const duracaoTemporaria = video.duration ? duracaoCurta(video.duration) : null;

  const miniatura = "/api/acervo/miniatura?source=" + encodeURIComponent(video.source) + "&rel=" + encodeURIComponent(video.relPath) + '&v=' + encodeURIComponent(video.mtimeMs);
  const selos = [];
  if (video.delivery?.status === "final") selos.push('<span class="selo selo-master">Final registrado</span>');
  else if (video.delivery?.status === "candidate") selos.push('<span class="selo selo-pendente">A confirmar</span>');
  if (video.aspect === "portrait") selos.push('<span class="selo selo-vertical">9:16</span>');
  if (video.source !== "entregas") selos.push('<span class="selo selo-fonte">' + escapar(video.source) + "</span>");
  carta.innerHTML =
    '<div class="quadro">' +
      '<img loading="lazy" decoding="async" src="' + miniatura + '" alt="" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'vazio\',textContent:\'sem prévia\'}))">' +
      '<span class="tempo">' + (duracaoTemporaria || (video.status === 'unavailable' ? 'Indisponível' : 'Medindo…')) + "</span>" +
      '<div class="selos-midia">' + selos.join("") + "</div>" +
    "</div>" +
    '<div class="info">' +
      '<div class="tit">' + escapar(tituloDoCard(video)) + "</div>" +
      '<div class="meta">' +
      '<span class="medida">' + resumoMedida(video) + "</span><span>" + tamanhoLegivel(video.sizeMb) + "</span></div>" +
      '<div class="criacao">' + escapar(criacaoDoCard(video)) + '</div>' +
      etiquetasDoVideo(video) +
    "</div>";
  carta.onclick = () => abrirLeitor(video);
  adicionarFavorito(carta, video);
  adicionarInfoCard(carta, video);
  adicionarBarraPrevia(carta, video);
  carta.addEventListener("mouseenter", () => agendarPrevia(carta, video));
  carta.addEventListener("mouseleave", () => cancelarPrevia(carta));
  carta.querySelector('.tit').title = tituloDoCard(video);
  palco.appendChild(carta);
  observarMedicao(carta, video);
  return carta;
}

area.addEventListener("scroll", agendarDesenho, { passive: true });
window.addEventListener("resize", agendarDesenho);

// ---------- leitor ----------

let videoNoLeitor = null;
let fichaCarregada = false;

async function abrirLeitor(video) {
  pararPrevia();
  cancelarAntecipacao();
  const leitor = document.getElementById("leitor");
  const player = document.getElementById("player");
  if (modoVisual === "galeria") definirModo("apresentacao", false);
  videoNoLeitor = video;
  solicitarMedicao(video);
  fichaCarregada = false;
  leitor.style.setProperty("--proporcao", proporcaoConhecida(video));
  player.poster = '/api/acervo/miniatura?source=' + encodeURIComponent(video.source) + '&rel=' + encodeURIComponent(video.relPath) + '&v=' + video.mtimeMs;
  player.src = fonteParaTocar(video);
  leitor.classList.add("aberto");
  tocarPlayer();
  sincronizarApresentacao();
  desenhar();

  document.getElementById("dossie").innerHTML =
    cabecaDossie(video) + '<div class="dossie-corpo"><div class="nada">Montando o dossiê…</div></div>';
  // Trocar de peça com a ficha aberta (pelos irmãos) mantém a ficha aberta.
  if (leitor.classList.contains("com-ficha")) carregarFicha(video);
}

function proporcaoConhecida(video) {
  if (video.aspect === "portrait") return 9 / 16;
  if (video.aspect === "square") return 1;
  return 16 / 9;
}

// A proporção exata só chega com o metadata do arquivo. Até lá vale o formato
// que o catálogo já mediu, para o quadro não nascer 16:9 e pular para 9:16.
document.getElementById("player").addEventListener("loadedmetadata", (evento) => {
  const player = evento.currentTarget;
  if (videoNoLeitor && Number.isFinite(player.duration) && player.duration > 0) receberMedicao(videoNoLeitor, { duration: player.duration, width: player.videoWidth, height: player.videoHeight, status: "measured" });
  if (!player.videoWidth || !player.videoHeight) return;
  document.getElementById("leitor").style.setProperty("--proporcao", player.videoWidth / player.videoHeight);
});

/**
 * A ficha só é buscada quando alguém pede. Assistir é o caso comum e não deve
 * pagar a leitura de receita, quadros-chave e irmãos que ninguém abriu.
 */
async function carregarFicha(video) {
  if (!video || fichaCarregada) return;
  fichaCarregada = true;
  const lado = document.getElementById("dossie");
  try {
    const resposta = await fetch("/api/acervo/dossie?source=" + encodeURIComponent(video.source) + "&rel=" + encodeURIComponent(video.relPath));
    const info = await resposta.json();
    if (videoNoLeitor !== video) return;
    lado.innerHTML = cabecaDossie(video, info) + '<div class="dossie-corpo">' + corpoDossie(video, info) + "</div>";
  } catch {
    if (videoNoLeitor !== video) return;
    fichaCarregada = false;
    lado.innerHTML = cabecaDossie(video) + '<div class="dossie-corpo"><div class="nada">Não deu para montar o dossiê agora.</div></div>';
  }
}

function alternarFicha() {
  const leitor = document.getElementById("leitor");
  const aberta = leitor.classList.toggle("com-ficha");
  document.getElementById("btn-ficha").classList.toggle("ativo", aberta);
  document.getElementById("dossie").setAttribute("aria-hidden", String(!aberta));
  if (aberta) carregarFicha(videoNoLeitor);
}

function cabecaDossie(video, info) {
  const selos = [];
  if (video.delivery?.status === "final") selos.push('<span class="selo selo-master">Final registrado</span>');
  else if (video.delivery?.status === "candidate") selos.push('<span class="selo selo-pendente">A confirmar</span>');
  if (info && info.receita) selos.push('<span class="fita fita-ok">receita ligada</span>');
  else if (info) selos.push('<span class="fita fita-falta">sem receita</span>');
  return '<div class="dossie-topo">' +
    '<div class="colecao">' + escapar(video.colecaoCurta || "sem coleção") + "</div>" +
    "<h2>" + escapar(video.title) + "</h2>" +
    '<div style="display:flex;gap:.35rem;flex-wrap:wrap">' + selos.join("") + "</div>" +
    "</div>";
}

/**
 * O dossiê mostra o que existe e deixa vazio o que não existe. Medido em
 * 02/09/2026 sobre 720 coleções: 17% têm receita mostrável, 87% têm ao menos
 * recibo. Preencher lacuna com palpite seria pior que a lacuna.
 */
function corpoDossie(video, info) {
  const r = info.receipt || {};
  const prompt = r.userPrompt || r.prompt || r.effectivePrompt || (r.request && r.request.prompt) || null;
  const partes = [];

  partes.push(secao("O pedido", prompt ? '<div class="prosa">' + escapar(prompt) + "</div>" : null, campoOrigem(video, info)));
  partes.push(secaoReceita(info.receita));

  const linhas = [];
  if (r.provider) linhas.push(["Provedor", r.provider]);
  if (r.model) linhas.push(["Modelo", r.model]);
  if (r.operation || r.task) linhas.push(["Operação", r.operation || r.task]);
  if (r.parameters && r.parameters.task) linhas.push(["Tarefa", r.parameters.task]);
  if (r.parameters && r.parameters.aspectRatio) linhas.push(["Formato", r.parameters.aspectRatio]);
  if (r.providerResponse && r.providerResponse.fileId) linhas.push(["Handle do provedor", r.providerResponse.fileId, true]);
  linhas.push(["Gerado em", new Date(video.mtimeMs).toLocaleString("pt-BR")]);
  linhas.push(["Duração", video.duration ? duracaoCurta(video.duration) : "não medida"]);
  linhas.push(["Tamanho", video.sizeMb + " MB"]);
  partes.push(secao("Como foi gerado", '<dl class="par">' + linhas.map(function (par) {
    return "<dt>" + escapar(par[0]) + "</dt><dd" + (par[2] ? ' class="mono"' : "") + ">" + escapar(String(par[1])) + "</dd>";
  }).join("") + "</dl>"));

  partes.push(secaoMaterial(video, info.material || {}));
  partes.push(secaoIrmaos(video, info));

  const arquivos = [["Arquivo", video.relPath]];
  if (info.receiptFile) arquivos.push(["Recibo", info.receiptFile]);
  const botao = '<button style="margin-top:.6rem" onclick="abrirPasta(' + JSON.stringify(JSON.stringify({ source: video.source, rel: video.relPath })).replace(/"/g, "&quot;") + ')">Abrir a pasta</button>';
  partes.push(secao("Arquivos", '<dl class="par">' + arquivos.map(function (par) {
    return "<dt>" + escapar(par[0]) + '</dt><dd class="mono">' + escapar(par[1]) + "</dd>";
  }).join("") + "</dl>" + botao));

  return partes.join("");
}

function secao(titulo, conteudo, vazioHtml, conta) {
  const cheia = Boolean(conteudo);
  return '<div class="secao' + (cheia ? "" : " vazia") + '"><h3>' + escapar(titulo) +
    (conta ? '<span class="conta">' + conta + "</span>" : "") + "</h3>" +
    (cheia ? conteudo : (vazioHtml || '<div class="nada">não há</div>')) + "</div>";
}

function par(chave, valor) {
  return "<dt>" + escapar(chave) + "</dt><dd>" + escapar(String(valor)) + "</dd>";
}

/**
 * Cada formato de receita tem blocos próprios. Mostrar o que reconhecemos em
 * prosa, e oferecer o resto cru — em vez de despejar JSON na cara da pessoa.
 */
function secaoReceita(receita) {
  if (!receita) {
    return secao("A receita", null,
      '<div class="nada">Esta coleção não tem receita ligada. A maioria das peças antigas nasceu de lote cru ou de script avulso — não havia receita para guardar.</div>');
  }
  const c = receita.conteudo || {};
  const blocos = [];

  const cabeca = [];
  const nome = c.label || c.name || (c.identity && c.identity.name);
  if (nome) cabeca.push(par("Nome", nome));
  if (c.cliente) cabeca.push(par("Cliente", c.cliente));
  if (c.description) cabeca.push(par("Sobre", c.description));
  if (receita.schema) cabeca.push(par("Formato", receita.schema));
  cabeca.push(par("Origem", receita.origem === "arquivo-nomeado" ? "arquivo de receita" : "documento da própria coleção"));
  blocos.push('<dl class="par">' + cabeca.join("") + "</dl>");

  if (typeof c.roteiro === "string" && c.roteiro.trim()) {
    blocos.push('<h3 style="margin-top:1rem">Roteiro</h3><div class="prosa">' + escapar(c.roteiro) + "</div>");
  }

  if (c.identidade) {
    const i = c.identidade;
    const itens = [];
    if (i.nome) itens.push(par("Identidade", i.nome));
    if (i.tipografia) itens.push(par("Tipografia", i.tipografia));
    if (Array.isArray(i.movimentos)) itens.push(par("Quadros", i.movimentos.length));
    if (Array.isArray(i.gestos)) itens.push(par("Gestos do texto", i.gestos.length));
    if (itens.length) blocos.push('<h3 style="margin-top:1rem">Linguagem visual</h3><dl class="par">' + itens.join("") + "</dl>");
    if (i.base) blocos.push('<div class="prosa tecnica">' + escapar(i.base) + "</div>");
    if (Array.isArray(i.movimentos) && i.movimentos.length) {
      blocos.push('<ol class="lista-seca" style="margin-top:.5rem">' + i.movimentos.map(function (m) {
        return "<li><b>" + escapar(m.nome || "") + "</b> · até " + escapar(String(m.ate)) +
          '<br><span style="color:var(--tinta-tenue)">' + escapar(String(m.cena || "").slice(0, 200)) + "</span></li>";
      }).join("") + "</ol>");
    }
  }

  const som = [];
  if (c.narracao) som.push(par("Locução", [c.narracao.voice, c.narracao.provider, c.narracao.language].filter(Boolean).join(" · ")));
  if (c.trilha) som.push(par("Trilha", [c.trilha.backend, c.trilha.ganhoDb].filter(Boolean).join(" · ")));
  if (c.segmentacao && c.segmentacao.maxWords) som.push(par("Palavras por bloco", c.segmentacao.maxWords));
  if (som.length) blocos.push('<h3 style="margin-top:1rem">Som e sincronia</h3><dl class="par">' + som.join("") + "</dl>");
  if (c.trilha && c.trilha.intencao) blocos.push('<div class="prosa tecnica">' + escapar(c.trilha.intencao) + "</div>");

  if (c.movimento) {
    const m = c.movimento;
    const itens = [];
    if (m.sobreamostragem) itens.push(par("Sobreamostragem", m.sobreamostragem + "×"));
    if (m.medido) itens.push(par("Medido em", m.medido));
    if (itens.length) blocos.push('<h3 style="margin-top:1rem">Movimento</h3><dl class="par">' + itens.join("") + "</dl>");
    if (m.porque) blocos.push('<div class="prosa tecnica">' + escapar(m.porque) + "</div>");
  }

  if (c.marca) {
    const itens = [];
    if (Array.isArray(c.marca.palavrasVetadas) && c.marca.palavrasVetadas.length) itens.push(par("Palavras vetadas", c.marca.palavrasVetadas.join(", ")));
    if (Array.isArray(c.marca.clichesEvitar) && c.marca.clichesEvitar.length) itens.push(par("Clichês a evitar", c.marca.clichesEvitar.join(", ")));
    if (itens.length) blocos.push('<h3 style="margin-top:1rem">Travas de marca</h3><dl class="par">' + itens.join("") + "</dl>");
    if (c.marca.notas) blocos.push('<div class="prosa tecnica">' + escapar(c.marca.notas) + "</div>");
  }

  if (Array.isArray(c.scenes) && c.scenes.length) {
    blocos.push('<h3 style="margin-top:1rem">Cenas <span class="conta">' + c.scenes.length + "</span></h3>" +
      '<ol class="lista-seca">' + c.scenes.slice(0, 40).map(function (s) {
        const texto = s.onScreenText ? '<br><span style="color:var(--tinta-tenue)">' + escapar(s.onScreenText) + "</span>" : "";
        return "<li>" + escapar(String(s.id || s.shotId || "")) + (s.duration ? " · " + s.duration + "s" : "") + texto + "</li>";
      }).join("") + "</ol>");
  }

  blocos.push('<details class="cru"><summary>Ver a receita crua</summary><pre>' +
    escapar(JSON.stringify(c, null, 2).slice(0, 20000)) + "</pre></details>");
  blocos.push('<dl class="par" style="margin-top:.6rem"><dt>Arquivo</dt><dd class="mono">' + escapar(receita.caminho) + "</dd></dl>");
  return secao("A receita", blocos.join(""));
}

function midiaDaColecao(video, relDentroDaColecao) {
  const caminho = video.colecaoCurta + "/" + relDentroDaColecao;
  return "/midia/" + video.source + "/" + caminho.split("/").map(encodeURIComponent).join("/");
}

function secaoMaterial(video, material) {
  const blocos = [];
  if (material.roteiro) {
    blocos.push('<h3 style="margin-top:0">Roteiro guardado na coleção</h3><div class="prosa">' + escapar(material.roteiro.texto) + "</div>");
  }
  if (material.imagens && material.imagens.length) {
    blocos.push('<h3 style="margin-top:1rem">Quadros-chave <span class="conta">' + material.imagens.length + "</span></h3>" +
      '<div class="tira">' + material.imagens.slice(0, 40).map(function (rel) {
        return '<img loading="lazy" src="' + midiaDaColecao(video, rel) + '" title="' + escapar(rel) + '" onclick="window.open(this.src)">';
      }).join("") + "</div>");
  }
  if (material.audios && material.audios.length) {
    blocos.push('<h3 style="margin-top:1rem">Áudio <span class="conta">' + material.audios.length + "</span></h3>" +
      '<div class="faixa-audio">' + material.audios.slice(0, 6).map(function (rel) {
        return '<div><div class="nome">' + escapar(rel) + '</div><audio controls preload="none" src="' + midiaDaColecao(video, rel) + '"></audio></div>';
      }).join("") + "</div>");
  }
  if (material.alinhamento) {
    blocos.push('<h3 style="margin-top:1rem">Sincronia</h3><dl class="par">' +
      par("Alinhamento", material.alinhamento.resumo) +
      "<dt>Arquivo</dt><dd class=\"mono\">" + escapar(material.alinhamento.arquivo) + "</dd></dl>");
  }
  if (material.marca && material.marca.length) {
    blocos.push('<h3 style="margin-top:1rem">Marca <span class="conta">' + material.marca.length + "</span></h3>" +
      '<div class="tira">' + material.marca.map(function (rel) {
        return '<img loading="lazy" src="' + midiaDaColecao(video, rel) + '" title="' + escapar(rel) + '" onclick="window.open(this.src)">';
      }).join("") + "</div>");
  }
  return secao("Material da coleção", blocos.length ? blocos.join("") : null,
    '<div class="nada">Nenhum quadro-chave, áudio ou roteiro guardado ao lado desta peça.</div>');
}

function secaoIrmaos(video, info) {
  const irmaos = info.irmaos || [];
  const col = info.colecao || {};
  if (!irmaos.length) return secao("A peça inteira", null, '<div class="nada">Este vídeo está sozinho na coleção.</div>');
  const resumo = '<dl class="par">' +
    par("Na coleção", col.totalVideos + " vídeos · " + col.masters + " final(is) registrado(s)") +
    par("Material total", col.duracaoSegundos ? duracaoLonga(col.duracaoSegundos) : "não medido") + "</dl>";
  const lista = '<div class="irmaos">' + irmaos.map(function (irmao) {
    return '<div class="irmao" onclick="abrirLeitorPorCaminho(' + JSON.stringify(irmao.relPath).replace(/"/g, "&quot;") + ')">' +
      '<span class="t' + (irmao.isMaster ? " marca-m" : "") + '">' + escapar(irmao.title) + "</span>" +
      '<span class="d">' + (irmao.duration ? duracaoCurta(irmao.duration) : "—") + "</span></div>";
  }).join("") + "</div>";
  return secao("A peça inteira", resumo + lista, null, irmaos.length);
}

function abrirLeitorPorCaminho(rel) {
  const alvo = TUDO.find(function (v) { return v.relPath === rel; });
  if (alvo) abrirLeitor(alvo);
}

/**
 * Metade do acervo não tem prompt, e quase sempre isso é normal: master montado
 * e peça de corte nascem do ffmpeg, não de um pedido. Dizer "sem recibo" em
 * amarelo para esses seria alarme falso — o que importa é dizer de onde veio.
 */
function campoOrigem(video, info) {
  const caminho = video.relPath;
  const operacao = (info.receipt && (info.receipt.operation || info.receipt.task)) || null;
  let texto;
  let cor = "var(--tinta-fraca)";
  if (caminho.includes("/_pecas/")) {
    texto = "Peça de montagem, cortada do master pelo ffmpeg. Não tem prompt próprio.";
  } else if (caminho.includes("/videos-unidos/")) {
    texto = "Vídeo na pasta de montagens. Os prompts podem estar nos clipes de origem; a pasta, por si só, não confirma uma entrega final.";
  } else if (operacao) {
    texto = "Gerado por operação local (" + escapar(operacao) + "), não por um pedido a provedor.";
  } else {
    texto = "Sem recibo ao lado — provavelmente de antes dos recibos serem universais.";
    cor = "var(--alerta)";
  }
  return '<div class="nada" style="color:' + cor + ';font-style:normal">' + texto + "</div>";
}

function abrirPasta(json) {
  fetch("/api/acervo/abrir-pasta", { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
}

function fecharLeitor() {
  cancelarAntecipacao();
  const player = document.getElementById("player");
  player.pause();
  player.removeAttribute("src");
  player.load();
  const leitor = document.getElementById("leitor");
  leitor.classList.remove("aberto");
  // A ficha não sobrevive ao fechamento: o próximo vídeo abre limpo, só o filme.
  leitor.classList.remove("com-ficha");
  document.getElementById("btn-ficha").classList.remove("ativo");
  document.getElementById("dossie").setAttribute("aria-hidden", "true");
  videoNoLeitor = null;
  automatico = false;
  definirModo("galeria", false);
  sincronizarApresentacao();
  desenhar();
}

document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const leitor = document.getElementById("leitor");
  if (!leitor.classList.contains("aberto")) return;
  if (document.fullscreenElement) return;
  // Esc fecha primeiro a ficha, depois o leitor: um passo de cada vez.
  if (leitor.classList.contains("com-ficha")) alternarFicha();
  else fecharLeitor();
});

// ---------- utilidades ----------

function duracaoCurta(segundos) {
  const total = Math.round(segundos);
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}
function duracaoLonga(segundos) {
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.round((segundos % 3600) / 60);
  return horas ? horas + "h " + minutos + "min" : minutos + "min";
}
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (caractere) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
}
function cssEscapar(texto) {
  return String(texto).replace(/["\\]/g, "\\$&");
}

// ---------- auto atualização ----------

function flagAutoreindex() {
  const query = new URLSearchParams(window.location.search);
  const valor = (query.get("autoreindex") || "").toLowerCase();
  return valor === "1" || valor === "true" || valor === "on" || valor === "sim";
}

function intervaloAutoreindexSegundos() {
  const query = new URLSearchParams(window.location.search);
  const valor = parseInt(query.get("autoreindexInterval") || "30", 10);
  if (!Number.isFinite(valor) || valor <= 0) return 30;
  return Math.min(300, Math.max(10, valor));
}

function iniciarAutoreindex() {
  if (!flagAutoreindex()) return;
  const intervalo = intervaloAutoreindexSegundos();
  if (autoReindexTimer) clearInterval(autoReindexTimer);
  autoReindexTimer = setInterval(() => { if (!document.hidden) carregar(true).catch(() => {}); }, intervalo * 1000);
  document.addEventListener("beforeunload", () => clearInterval(autoReindexTimer));
}

// ---------- controles ----------

let debounce = null;
document.getElementById("busca").addEventListener("input", (evento) => {
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    termo = evento.target.value.trim().toLowerCase();
    idsPorPrompt = null;
    aplicar();
    // O casamento por nome já apareceu; o por prompt chega logo depois e amplia
    // a lista, em vez de fazer a pessoa esperar pelos dois.
    if (termo.length >= 3) {
      const alvo = termo;
      try {
        const resposta = await fetch("/api/acervo/buscar-prompt?q=" + encodeURIComponent(alvo));
        const dados = await resposta.json();
        if (alvo !== termo || dados.curtoDemais) return;
        idsPorPrompt = new Set(dados.ids);
        aplicar();
      } catch { /* sem busca por prompt, a busca por nome continua valendo */ }
    }
  }, 160);
});
let debounceColecao = null;
document.getElementById("busca-colecao").addEventListener("input", (evento) => {
  clearTimeout(debounceColecao);
  debounceColecao = setTimeout(() => { filtroColecao = evento.target.value; montarLateral(); }, 120);
});
document.getElementById("ordem").addEventListener("change", aplicar);
porId("origem").addEventListener("change", aplicar);
document.getElementById("formato").addEventListener("change", (evento) => { formato = evento.target.value; aplicar(); });
document.getElementById("btn-master").addEventListener("click", (evento) => {
  soMasters = !soMasters;
  evento.currentTarget.classList.toggle("ativo", soMasters);
  evento.currentTarget.setAttribute('aria-pressed', String(soMasters));
  aplicar();
});
iniciarVisualizacao();
document.getElementById("ordem").value = "recentes";
carregar().then(() => carregar(true).catch(() => { porId('resumo-nota').textContent = 'Índice anterior disponível; atualização pendente.'; }))
  .catch(() => { palco.innerHTML = '<div class="estado"><b>Não foi possível carregar o acervo</b>Recarregue a página para tentar novamente.</div>'; });
iniciarAutoreindex();
