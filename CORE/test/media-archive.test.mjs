import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";

import {
  aspectClass,
  buildCatalog,
  cacheHit,
  classifyVideo,
  humanize,
  measurePending,
  resolveInsideRoot,
  scanVideos,
} from "../lib/media-pipeline/media-archive.mjs";

const temporaryRoots = [];
after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-archive-"));
  temporaryRoots.push(root);
  return root;
}

async function isolatedArchive() {
  const root = makeRoot();
  // Executa os módulos reais, byte a byte, com as raízes derivadas de import.meta
  // dentro da fixture. Não altera FONTES nem lê acervo, cache ou receitas reais.
  for (const file of ["app/editor/acervo.mjs", "app/editor/acervo-index-worker.mjs", "app/editor/acervo-groups.mjs", "lib/media-pipeline/media-archive.mjs", "lib/media-pipeline/archive-delivery.mjs"]) {
    touch(root, `CORE/${file}`, fs.readFileSync(new URL(`../${file}`, import.meta.url)));
  }
  return { root: path.join(root, "CORE"), archive: await import(pathToFileURL(path.join(root, "CORE/app/editor/acervo.mjs")).href) };
}

function touch(root, relPath, content = "video") {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

test("confinamento recusa travessia, caminho absoluto, byte nulo e extensão errada", () => {
  const root = makeRoot();
  touch(root, "colecao/clipe.mp4");
  touch(root, "colecao/nota.txt");
  const foraDoRoot = touch(makeRoot(), "fora.mp4", "x");

  assert.ok(resolveInsideRoot(root, "colecao/clipe.mp4"));
  assert.equal(resolveInsideRoot(root, "../fuga.mp4"), null);
  assert.equal(resolveInsideRoot(root, "../../Windows/win.ini"), null);
  assert.equal(resolveInsideRoot(root, foraDoRoot), null);
  assert.equal(resolveInsideRoot(root, "colecao/clip\0e.mp4"), null);
  assert.equal(resolveInsideRoot(root, "colecao/nota.txt"), null);
  assert.equal(resolveInsideRoot(root, "colecao/nao-existe.mp4"), null);
  assert.equal(resolveInsideRoot(root, ""), null);
});

test("varredura é recursiva e só recolhe mp4", () => {
  const root = makeRoot();
  touch(root, "a/um.mp4");
  touch(root, "a/videos-soltos/dois.mp4");
  touch(root, "a/leia.txt");

  const found = scanVideos(root).map((file) => file.relPath).sort();
  assert.deepEqual(found, ["a/um.mp4", "a/videos-soltos/dois.mp4"]);
  assert.equal(scanVideos(path.join(os.tmpdir(), "nao-existe-999")).length, 0);
});

test("master é reconhecido por nome e por pasta; 3X conta como master", () => {
  const cases = [
    ["exemplo-3X-acelerado.mp4", "col/exemplo-3X-acelerado.mp4", true, true],
    ["filme-unificado-master.mp4", "col/filme-unificado-master.mp4", true, false],
    ["x-partes-juntas.mp4", "col/videos-unidos/x-partes-juntas.mp4", true, false],
    ["01-capitulo.mp4", "col/01-capitulo.mp4", false, false],
    ["03-max3x-teste.mp4", "col/03-max3x-teste.mp4", false, false],
  ];
  for (const [filename, relPath, isMaster, is3x] of cases) {
    const result = classifyVideo({ filename, relPath });
    assert.equal(result.isMaster, isMaster, filename);
    assert.equal(result.is3x, is3x, filename);
  }
});

test("proporção vem da medição, nunca do nome do arquivo", () => {
  assert.equal(aspectClass(1280, 720), "landscape");
  assert.equal(aspectClass(720, 1280), "portrait");
  assert.equal(aspectClass(1080, 1080), "square");
  assert.equal(aspectClass(null, null), "unknown");
});

test("rótulo genérico tira timestamp e numeração, sem tabela de projeto", () => {
  assert.equal(humanize("20260717215931-faca-um-video"), "Faca um video");
  assert.equal(humanize("01-capitulo-01-cidade.mp4"), "Capitulo 01 cidade");
  assert.equal(humanize("my_holiday_clips"), "My holiday clips");
  assert.equal(humanize("123"), "123");
});

test("cache é reaproveitado e invalidado por tamanho ou mtime", () => {
  const file = { relPath: "a/um.mp4", size: 100, mtimeMs: 1000 };
  const cache = { "a/um.mp4": { size: 100, mtimeMs: 1000, width: 1280, height: 720, duration: 10 } };

  assert.ok(cacheHit(cache, file));
  assert.equal(cacheHit(cache, { ...file, size: 101 }), null);
  assert.equal(cacheHit(cache, { ...file, mtimeMs: 999_999 }), null);
  assert.equal(cacheHit({}, file), null);
});

test("medição respeita concorrência, ignora falha e avisa cada resultado", async () => {
  const root = makeRoot();
  touch(root, "a/um.mp4");
  touch(root, "a/dois.mp4");
  touch(root, "a/quebrado.mp4");

  const files = scanVideos(root);
  const cache = {};
  const avisos = [];
  let ativos = 0;
  let pico = 0;

  const probe = async (fullPath) => {
    ativos += 1;
    pico = Math.max(pico, ativos);
    await new Promise((resolve) => setTimeout(resolve, 5));
    ativos -= 1;
    if (fullPath.includes("quebrado")) return null;
    return { width: 1280, height: 720, duration: 10 };
  };

  const result = await measurePending(files, cache, { concurrency: 2, probe, onMeasured: (rel) => avisos.push(rel) });

  assert.equal(result.pending, 3);
  assert.equal(result.measured, 2);
  assert.equal(avisos.length, 2);
  assert.ok(pico <= 2, `concorrência estourou: ${pico}`);
  assert.equal(cache["a/quebrado.mp4"], undefined);

  // segunda passada não remede o que já está em cache
  const segunda = await measurePending(scanVideos(root), cache, { concurrency: 2, probe });
  assert.equal(segunda.pending, 1);
});

test("catálogo junta medição e índice de prompt, e conta cobertura", () => {
  const root = makeRoot();
  touch(root, "colecao-a/01-clipe.mp4");
  touch(root, "colecao-a/filme-master.mp4");
  touch(root, "colecao-b/02-clipe.mp4");

  const files = scanVideos(root);
  const cache = {};
  for (const file of files) {
    cache[file.relPath] = { size: file.size, mtimeMs: file.mtimeMs, width: 1280, height: 720, duration: 10 };
  }

  const prompts = {
    entries: {
      "colecao-a/01-clipe.mp4": { prompt: "p", promptComposition: { directionPreset: "aquarela-2d@1" } },
    },
  };

  const catalog = buildCatalog(root, { cache, prompts });

  assert.equal(catalog.stats.total, 3);
  assert.equal(catalog.stats.masters, 1);
  assert.equal(catalog.stats.collections, 2);
  assert.equal(catalog.stats.measured, 3);
  assert.equal(catalog.stats.withPrompt, 1);
  assert.equal(catalog.stats.promptCoverage, 33.3);

  const comPrompt = catalog.videos.find((video) => video.relPath === "colecao-a/01-clipe.mp4");
  assert.equal(comPrompt.hasPrompt, true);
  assert.equal(comPrompt.directionPreset, "aquarela-2d@1");
  assert.equal(comPrompt.aspect, "landscape");

  const semPrompt = catalog.videos.find((video) => video.relPath === "colecao-b/02-clipe.mp4");
  assert.equal(semPrompt.hasPrompt, false);
  assert.equal(semPrompt.directionPreset, null);
});

test("vídeo sem medição aparece no catálogo como pendente, não some", () => {
  const root = makeRoot();
  touch(root, "a/um.mp4");

  const catalog = buildCatalog(root, { cache: {} });
  assert.equal(catalog.stats.total, 1);
  assert.equal(catalog.stats.pendingMeasure, 1);
  assert.equal(catalog.videos[0].width, null);
  assert.equal(catalog.videos[0].aspect, "unknown");
});

test("cache gravado pela medição casa na varredura seguinte (regressão: tamanho derivado de sizeMb)", async () => {
  const root = makeRoot();
  // tamanhos que NÃO sobrevivem a um round-trip por sizeMb (1 casa decimal)
  touch(root, "a/um.mp4", "x".repeat(2_346_211));
  touch(root, "a/dois.mp4", "x".repeat(2_468_953));

  const cache = {};
  const probe = async () => ({ width: 1280, height: 720, duration: 10 });

  const first = await measurePending(scanVideos(root), cache, { probe });
  assert.equal(first.measured, 2);

  // o catálogo publica sizeMb arredondado; se alguém reconstruir bytes a partir
  // dele, o cacheHit para de casar e o acervo é remedido a cada carregamento
  const catalog = buildCatalog(root, { cache });
  assert.equal(catalog.stats.measured, 2, "cache não casou logo após ser gravado");
  assert.equal(catalog.stats.pendingMeasure, 0);

  const second = await measurePending(scanVideos(root), cache, { probe });
  assert.equal(second.pending, 0, "remediu arquivo que já estava medido");

  for (const file of scanVideos(root)) {
    assert.equal(cache[file.relPath].size, file.size, `tamanho no cache diverge do disco: ${file.relPath}`);
  }
});

test("fragmento de montagem nunca é master, mesmo dentro de videos-unidos", () => {
  // Os cortes de um segundo que o ffmpeg produz para remontar o filme moram em
  // `videos-unidos/_pecas/`. Pela regra de caminho eles herdavam "master" do pai
  // — e podiam encher a primeira tela com fragmentos no lugar da peça pronta.
  const fragmento = classifyVideo({ filename: "p-s51.mp4", relPath: "colecao-exemplo/videos-unidos/_pecas/p-s51.mp4" });
  assert.equal(fragmento.isFragmentoDeMontagem, true);
  assert.equal(fragmento.isMaster, false);

  const master = classifyVideo({ filename: "EXEMPLO.mp4", relPath: "colecao-exemplo/videos-unidos/EXEMPLO.mp4" });
  assert.equal(master.isFragmentoDeMontagem, false);
  assert.equal(master.isMaster, true);

  // Nem o nome "master" salva um fragmento.
  const disfarcado = classifyVideo({ filename: "master-parcial.mp4", relPath: "x/videos-unidos/_pecas/master-parcial.mp4" });
  assert.equal(disfarcado.isMaster, false);
});

test("o catálogo carrega a marca do fragmento até o vídeo", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "media-archive-frag-"));
  try {
    fs.mkdirSync(path.join(raiz, "peca", "videos-unidos", "_pecas"), { recursive: true });
    fs.writeFileSync(path.join(raiz, "peca", "videos-unidos", "FINAL.mp4"), "x");
    fs.writeFileSync(path.join(raiz, "peca", "videos-unidos", "_pecas", "p-s1.mp4"), "x");
    const catalogo = buildCatalog(raiz);
    const porNome = new Map(catalogo.videos.map((v) => [v.filename, v]));
    assert.equal(porNome.get("FINAL.mp4").isFragmentoDeMontagem, false);
    assert.equal(porNome.get("FINAL.mp4").isMaster, true);
    assert.equal(porNome.get("p-s1.mp4").isFragmentoDeMontagem, true);
    assert.equal(porNome.get("p-s1.mp4").isMaster, false);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("busca por prompt casa no texto do pedido e recusa termo curto demais", async () => {
  const { root, archive: { buscarPorPrompt } } = await isolatedArchive();
  touch(root, ".cache/prompt-index.json", JSON.stringify({ entries: {
    "sintetica/videos-unidos/FINAL.mp4": { userPrompt: "formas AZUIS em movimento" },
    "outra/videos-unidos/FINAL.mp4": { prompt: "formas vermelhas" },
  } }));
  assert.deepEqual(buscarPorPrompt("azuis").ids, ["entregas/sintetica/videos-unidos/FINAL.mp4"]);
  const curto = buscarPorPrompt("ab");
  assert.equal(curto.curtoDemais, true);
  assert.deepEqual(curto.ids, [], "termo de duas letras casaria com quase tudo");
  const vazio = buscarPorPrompt("   ");
  assert.equal(vazio.curtoDemais, true);
});

test("o dossiê completo junta receita, material e irmãos, e deixa vazio o que não existe", async () => {
  const { root, archive: { dossieCompleto } } = await isolatedArchive();
  touch(root, "outputs/sintetica/videos-unidos/FINAL.mp4");
  touch(root, "outputs/sintetica/videos-soltos/parte.mp4");
  touch(root, "outputs/sintetica/metadados/roteiro.txt", "Roteiro sintético");
  touch(root, "outputs/sintetica/audio/voz.wav", "fixture de inventário, sem decodificação");
  for (let index = 0; index < 12; index++) touch(root, `outputs/sintetica/imagens/quadro-${index}.png`);
  touch(root, "recipes/sintetica.receita.json", JSON.stringify({ collection: "sintetica", schema: "fixture" }));
  const rico = dossieCompleto("entregas", "sintetica/videos-unidos/FINAL.mp4");
  assert.ok(rico, "a fixture deve sempre executar as asserções do dossiê");
  assert.equal(rico.receita.origem, "arquivo-nomeado");
  assert.equal(rico.material.roteiro.texto, "Roteiro sintético");
  assert.equal(rico.material.imagens.length, 12);
  assert.deepEqual(rico.material.audios, ["audio/voz.wav"]);
  assert.equal(rico.colecao.totalVideos, 2);
  assert.equal(rico.irmaos.length, 1);
  touch(root, "outputs/vazia/videos-unidos/FINAL.mp4");
  const vazio = dossieCompleto("entregas", "vazia/videos-unidos/FINAL.mp4");
  assert.equal(vazio.receita, null);
  assert.equal(vazio.material.roteiro, null);
  assert.deepEqual(vazio.material.imagens, []);
  // Caminho que não existe não inventa nada.
  assert.equal(dossieCompleto("entregas", "nao/existe/nada.mp4"), null);
  assert.equal(dossieCompleto("fonte-inventada", "x.mp4"), null);
});
