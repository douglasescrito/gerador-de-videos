// Portão de validação da pasta de receitas.
//
// Discovery, sugestões e validação compartilham o padrão de nome e usam os
// validadores produtivos. A extensão de um formato não pode fazê-lo sumir da
// prateleira, nem um provider indisponível tornar sua estrutura inválida.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validarReceita } from "./recipe-compiler.mjs";
import { parseMasterRecipe, preflightResolvedMasterRecipe, resolveMasterRecipe } from "./master-recipe-v2.mjs";
import { PADRAO_RECEITA } from "./recipe-shelf.mjs";

export const RECIPE_VALIDATION_SCHEMA = "gerador-de-videos/recipe-validation-report@1";

/**
 * `<nome>.receita.json` e as variantes que declaram o formato no próprio nome,
 * como `.receita-v2.5b.json`. Tudo o mais na pasta se identifica por outro
 * sufixo — `.rascunho.json`, `.preproduction.json`, `.producao.json`,
 * `jobs-*.json` — e fica de fora sem reprovar.
 */
export { PADRAO_RECEITA };
export const SUFIXO_RECEITA = ".receita.json";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const schemaSincroniaFile = path.resolve(aqui, "..", "..", "schemas", "receita-sincronia-imagem.schema.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true, allowUnionTypes: true });
addFormats(ajv);
const validarSincroniaImagem = ajv.compile(JSON.parse(fs.readFileSync(schemaSincroniaFile, "utf8")));

/**
 * Cada schema é validado por quem realmente o executa, não por uma segunda
 * implementação: receita@1 pelo compilador, receita@2 pelo resolvedor da
 * Receita Mestre, sincronia-imagem pelo JSON Schema que o executor espelha.
 *
 * Vale a pena separar validar de pré-voo. `resolveMasterRecipe` checa forma;
 * `preflight` checa se o provedor está liberado hoje. Uma receita bem escrita
 * que depende de capacidade ainda não comprovada é válida e apenas não pode
 * rodar — reprová-la aqui faria o portão mentir.
 */
const VALIDADORES = new Map([
  ["gerador-de-videos/receita@1", (r) => ({ recipe: validarReceita(r) })],
  ["gerador-de-videos/receita@2", (_r, bytes) => {
    const resolved = resolveMasterRecipe(parseMasterRecipe(bytes));
    return { recipe: resolved.recipe, resolved };
  }],
  ["gerador-de-videos/receita-sincronia-imagem@1", (r) => {
    if (validarSincroniaImagem(r)) return { recipe: structuredClone(r) };
    const primeiro = validarSincroniaImagem.errors[0];
    throw new Error(`${primeiro.instancePath || "/"} ${primeiro.message}`);
  }],
]);

export function schemasComValidador() {
  return [...VALIDADORES.keys()];
}

export function validarDocumentoReceita(source) {
  const bytes = Buffer.isBuffer(source) || typeof source === "string" ? source : JSON.stringify(source);
  const raw = JSON.parse(bytes);
  const schema = typeof raw?.schema === "string" ? raw.schema : null;
  const validator = VALIDADORES.get(schema);
  if (!validator) throw new Error(schema
    ? `schema sem validador: ${schema}. Escreva o validador ou renomeie o arquivo para fora do padrão ${SUFIXO_RECEITA}.`
    : "sem campo schema. Toda receita declara o formato que segue.");
  return validator(raw, bytes);
}

/** Projeção comum sem compilar: listar uma receita não exige provider pronto. */
export function descreverReceita(source, { capabilities } = {}) {
  const { recipe, resolved } = validarDocumentoReceita(source);
  const preflight = {
    ...(resolved ? preflightResolvedMasterRecipe(resolved, { capabilities }) : { status: "not-checked", blockers: [], checks: [], providerCalls: 0 }),
    assetBytesChecked: false,
    runtimeAdmissionChecked: false,
  };
  if (resolved) {
    const productionCount = recipe.kind === "lote" ? recipe.batch.rows.length : 1;
    return {
      recipe,
      schema: recipe.schema,
      id: recipe.identity.id,
      label: recipe.identity.name,
      description: null,
      kind: recipe.kind,
      motor: "filme",
      aspect: resolved.derived.aspect,
      style: null,
      collection: null,
      outputCount: recipe.program.shots.length * productionCount,
      productionCount,
      targetDurationSeconds: resolved.derived.durationSeconds,
      valid: true,
      preflight,
    };
  }
  const legacy = recipe.schema === "gerador-de-videos/receita@1";
  return {
    recipe,
    schema: recipe.schema,
    id: recipe.id,
    label: recipe.label,
    description: recipe.description ?? null,
    kind: legacy ? recipe.kind : "filme",
    motor: legacy ? (recipe.kind === "filme" ? "filme" : "lote") : "sincronia-imagem",
    aspect: recipe.aspect ?? null,
    style: recipe.style ?? null,
    collection: recipe.collection ?? null,
    outputCount: legacy ? (recipe.kind === "filme" ? recipe.scenes.length : recipe.parts.length * (recipe.matrix.length || 1)) : 1,
    targetDurationSeconds: legacy ? recipe.targetDurationSeconds : recipe.duracaoAlvoSegundos ?? null,
    valid: true,
    preflight,
  };
}

function listarReceitas(raiz) {
  const encontrados = [];
  const visitar = (diretorio) => {
    let entradas;
    try {
      entradas = fs.readdirSync(diretorio, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      if (entrada.isSymbolicLink()) continue;
      const absoluto = path.join(diretorio, entrada.name);
      if (entrada.isDirectory()) visitar(absoluto);
      else if (entrada.isFile() && PADRAO_RECEITA.test(entrada.name)) {
        encontrados.push(path.relative(raiz, absoluto).replace(/\\/g, "/"));
      }
    }
  };
  visitar(raiz);
  return encontrados.sort();
}

/**
 * Valida toda receita sob `raiz`. Somente leitura, provider-free: não chama
 * provedor, não escreve nada e não consome cota.
 */
export function validarPastaDeReceitas({ raiz = "recipes" } = {}) {
  const arquivos = listarReceitas(raiz);
  const validas = [];
  const invalidas = [];

  for (const relativo of arquivos) {
    const absoluto = path.join(raiz, relativo);
    let bytes;
    let receita;
    try {
      bytes = fs.readFileSync(absoluto);
      receita = JSON.parse(bytes);
    } catch (erro) {
      invalidas.push({ arquivo: relativo, schema: null, erro: `JSON ilegível: ${erro.message}` });
      continue;
    }

    const schema = typeof receita?.schema === "string" ? receita.schema : null;
    const validador = schema ? VALIDADORES.get(schema) : null;
    if (!validador) {
      invalidas.push({
        arquivo: relativo,
        schema,
        erro: schema
          ? `schema sem validador: ${schema}. Escreva o validador ou renomeie o arquivo para fora do padrão ${SUFIXO_RECEITA}.`
          : `sem campo schema. Toda receita declara o formato que segue.`,
      });
      continue;
    }

    try {
      validarDocumentoReceita(bytes);
      validas.push({ arquivo: relativo, schema });
    } catch (erro) {
      invalidas.push({ arquivo: relativo, schema, erro: String(erro?.message ?? erro).slice(0, 400) });
    }
  }

  return {
    schema: RECIPE_VALIDATION_SCHEMA,
    raiz,
    total: arquivos.length,
    validas,
    invalidas,
    ok: invalidas.length === 0,
    providerCalls: 0,
  };
}
