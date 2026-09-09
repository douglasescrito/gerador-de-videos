// O CLI tem 75 comandos e dezenas de opções por comando. Errar uma letra era
// receber 147 linhas de ajuda sem saber que o comando não existe. Estes
// testes seguram as mensagens que ensinam.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { dicaDeSugestao, distanciaDeEdicao, sugerir } from "../lib/cli/suggest.mjs";

const cli = path.resolve("scripts/omni-cli.mjs");
const rodar = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });

test("a distância de edição para de contar quando passa do limite", () => {
  assert.equal(distanciaDeEdicao("generate", "generate"), 0);
  assert.equal(distanciaDeEdicao("generat", "generate"), 1);
  assert.equal(distanciaDeEdicao("abc", "xyz", 1), 2, "acima do limite devolve limite+1, sem terminar a conta");
});

test("a sugestão prefere o prefixo à distância", () => {
  // Quem digita "flow" procura "flow-video", não errou uma letra.
  assert.deepEqual(sugerir("flow", ["flow-video", "flow-image", "generate"]).sort(), ["flow-image", "flow-video"]);
  assert.deepEqual(sugerir("generat", ["generate", "docs", "jobs"]), ["generate"]);
  assert.deepEqual(sugerir("xyzabc", ["generate", "docs", "jobs"]), []);
});

test("sem nada parecido, a dica aponta onde procurar em vez de calar", () => {
  assert.equal(dicaDeSugestao("generat", ["generate"]), "Você quis dizer generate?");
  // Só o que de fato é próximo: `--prompt-file` está a cinco edições de
  // `promptt` e somá-lo à dica só faria a pessoa duvidar da resposta certa.
  assert.equal(dicaDeSugestao("promptt", ["prompt", "prompt-file"], { prefixo: "--" }), "Você quis dizer --prompt?");
  // Entre dois prefixos válidos, o mais próximo em tamanho vem primeiro.
  assert.match(dicaDeSugestao("prompt-fil", ["prompt", "prompt-file"], { prefixo: "--" }), /^Você quis dizer --prompt-file/);
  assert.equal(dicaDeSugestao("xyzabc", ["generate"], { ondeProcurar: "veja os comandos" }), "veja os comandos");
});

test("comando com erro de digitação diz o que houve e sugere o certo", () => {
  const resultado = rodar(["generat", "--prompt", "x"]);
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /Comando desconhecido: generat\./);
  assert.match(resultado.stderr, /Você quis dizer generate\?/);
  // O que ele NÃO pode mais fazer: despejar a ajuda inteira sem explicar.
  assert.equal(resultado.stdout.includes("Gemini Omni Video CLI"), false);
});

test("comando sem nada parecido aponta a lista em vez de despejar ajuda", () => {
  const resultado = rodar(["xyzabc"]);
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /Comando desconhecido: xyzabc\./);
  assert.match(resultado.stderr, /npm run video -- commands/);
});

test("opção com erro de digitação sugere a opção do próprio comando", () => {
  const resultado = rodar(["generate", "--promptt", "x"]);
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /Opção desconhecida para generate: --promptt/);
  assert.match(resultado.stderr, /Você quis dizer --prompt/);
});

test("obrigatório faltando nomeia o comando e mostra a linha certa", () => {
  const resultado = rodar(["generate"]);
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /--prompt é obrigatório em generate\./);
  assert.match(resultado.stderr, /Exemplo: npm run video -- generate/);
});

test("a dica sai como texto para gente, além da linha JSON para agente", () => {
  const resultado = rodar(["generat"]);
  const linhas = resultado.stderr.trim().split(/\r?\n/);
  assert.equal(linhas[0], "Comando desconhecido: generat.");
  assert.equal(linhas[1], "Você quis dizer generate?");
  const json = JSON.parse(linhas[2]);
  assert.equal(json.schema, "mkt-videos/cli-error@1");
  assert.equal(json.code, "usage");
  assert.equal(json.hint, "Você quis dizer generate?");
});

test("commands lista em texto e busca tolerando acento e plural", () => {
  const texto = rodar(["commands", "--format", "texto"]);
  assert.equal(texto.status, 0, texto.stderr);
  assert.match(texto.stdout, /^ {2}generate {2,}/m);
  assert.match(texto.stdout, /npm run video -- <comando> --help/);

  const comAcento = rodar(["commands", "--format", "texto", "--buscar", "musica"]);
  assert.match(comAcento.stdout, /\bmusic\b/, "acento não pode esconder o comando");
  const plural = rodar(["commands", "--format", "texto", "--buscar", "trilhas"]);
  assert.match(plural.stdout, /\bmusic\b/);

  const nada = rodar(["commands", "--format", "texto", "--buscar", "zzzzzz"]);
  assert.notEqual(nada.status, 0);
  assert.match(nada.stdout, /Nenhum comando casa/);
});

test("o manifesto JSON continua sendo o padrão para agente", () => {
  const json = rodar(["commands"]);
  assert.equal(json.status, 0, json.stderr);
  const manifesto = JSON.parse(json.stdout);
  assert.equal(manifesto.schema, "mkt-videos/cli-manifest@1");
  assert.equal(manifesto.commands.length > 60, true);
  const filtrado = JSON.parse(rodar(["commands", "--buscar", "rodada"]).stdout);
  assert.equal(filtrado.busca, "rodada");
  assert.equal(filtrado.commands.some((entrada) => entrada.id === "rodada"), true);
});

test("o cartão de ajuda cabe na tela e não promete comando nem opção que não existe", () => {
  const ajuda = rodar(["help"]);
  assert.equal(ajuda.status, 0, ajuda.stderr);
  const linhas = ajuda.stdout.trim().split(/\r?\n/);
  // Eram 147 linhas: a parede que ninguém lia. O detalhe mudou de lugar,
  // não sumiu.
  assert.equal(linhas.length <= 40, true, `o cartão cresceu para ${linhas.length} linhas`);
  assert.match(ajuda.stdout, /npm run video -- commands/);
  assert.match(ajuda.stdout, /<comando> --help/);

  // Trava viva: toda linha de exemplo do cartão tem de existir no registry,
  // comando e opções. Ajuda que não roda é pior que ajuda nenhuma.
  const invocacoes = [...ajuda.stdout.matchAll(/npm run video -- ([a-z0-9-]+)((?: --[a-z0-9-]+(?: [^\s-][^\s]*)?)*)/g)];
  assert.equal(invocacoes.length >= 8, true, `poucos exemplos reconhecidos: ${invocacoes.length}`);
  const manifesto = new Map(JSON.parse(rodar(["commands"]).stdout).commands.map((entrada) => [entrada.id, entrada]));
  for (const [, id, cauda] of invocacoes) {
    const definicao = manifesto.get(id);
    assert.ok(definicao, `o cartão cita um comando que não existe: ${id}`);
    for (const flag of cauda.match(/--[a-z0-9-]+/g) ?? []) {
      assert.equal(definicao.options.includes(flag.slice(2)), true, `${id} não aceita ${flag}`);
    }
  }
});

test("commands agrupa por família e recusa família inexistente com sugestão", () => {
  const agrupado = rodar(["commands", "--format", "texto"]);
  assert.equal(agrupado.status, 0, agrupado.stderr);
  for (const familia of ["gerar", "audio", "montar", "filme", "receita", "acervo", "operacao", "catalogo"]) {
    assert.match(agrupado.stdout, new RegExp(`^${familia}$`, "m"), `família ausente: ${familia}`);
  }

  const soAudio = rodar(["commands", "--format", "texto", "--grupo", "audio"]);
  assert.match(soAudio.stdout, /^ {2}music {2,}/m);
  assert.doesNotMatch(soAudio.stdout, /^ {2}generate {2,}/m, "--grupo audio não pode listar comando de outra família");

  const errado = rodar(["commands", "--format", "texto", "--grupo", "audios"]);
  assert.notEqual(errado.status, 0);
  assert.match(errado.stderr, /Grupo desconhecido: audios\./);
  assert.match(errado.stderr, /Você quis dizer audio\?/);
});

test("todo comando do registry declara uma família conhecida", () => {
  const familias = new Set(["gerar", "audio", "montar", "filme", "receita", "acervo", "operacao", "catalogo"]);
  const comandos = JSON.parse(rodar(["commands"]).stdout).commands;
  const foraDeFamilia = comandos.filter((entrada) => !familias.has(entrada.grupo)).map((entrada) => `${entrada.id}=${entrada.grupo}`);
  assert.deepEqual(foraDeFamilia, [], "comando novo precisa declarar grupo no registry");
});
