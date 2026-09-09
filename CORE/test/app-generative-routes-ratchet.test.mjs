import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// O fitness ratchet iniciado na Fase 0 chegou a zero na Fase 2. O app
// Tauri não gera mídia diretamente — só o CLI/application service
// canônico pode fazê-lo (§2.2 do plano). Este teste impede regressão.
//
// Inventário completo com a natureza de cada rota:
// CORE/docs/FASE-0-INVENTARIO-SCHEMA-PAPEL.md, seção 4.
//
// Estado terminal da Fase 2: nenhuma exceção gerativa.
const GENERATIVE_ROUTE_ALLOWLIST = [];
// film/run, film/approve e film/resume saíram da allowlist (Fase 2, §7):
// removidos do Express — eram wrappers redundantes chamando exatamente
// runFilm/approveDraft/resumeFilm, que a CLI (`run`/`approve`/`resume`) já
// chama diretamente sobre o mesmo state file. Sem caller no frontend
// (confirmado por investigação: RecipeShelf.tsx desabilita produção até os
// bindings da Fase 1-2), então a remoção não tira nenhuma função hoje
// alcançável pela UI.
//
// generate-image e generate-video saíram também (mesma investigação, mesmo
// motivo): substituto real é a CLI (`image`, `generate`), que já carrega sua
// própria checagem de confirmProviderInput. O proxy upstream (para quando o
// app roda como thin client apontando pra um Omni remoto) TAMBÉM parou de
// encaminhar essas duas rotas — UPSTREAM_GENERATION_ROUTES foi removido de
// server.ts junto com as rotas diretas, fechando os dois modos ao mesmo
// tempo; ver isAllowedUpstreamRoute em server.ts.

// Rotas conferidas na leitura do código-fonte e confirmadas como estado
// local puro, sem tocar provider — não entram na varredura mesmo casando
// com o prefixo /api/batch ou /api/film.
const KNOWN_LOCAL_ONLY = new Set([
  "POST /api/batch/:id/cancel", // só seta flag de cancelamento e salva o job local
  "POST /api/batch/:id/reorder", // só reordena itens pendentes no job local
  "POST /api/batch/:id/items/:itemId/action", // decisão humana sobre um item (aprovar/rejeitar), sem chamada
  "POST /api/film/plan", // planFilm() é provider-free por contrato (film-orchestrator.mjs)
]);

// Heurística deliberadamente ampla: caminho contém "generate", ou é uma
// escrita em /batch, /film ou nas duas rotas de acervo que tocam o provider
// diretamente (persist baixa bytes do provider; transcribe roda Whisper
// local, mas ainda é execução que deveria estar só no CLI). Não tenta
// entender o corpo do handler — só a superfície, com a exceção explícita de
// KNOWN_LOCAL_ONLY acima para rotas já auditadas manualmente.
function looksGenerative(method, routePath) {
  if (method !== "POST") return false;
  const key = `${method} ${routePath}`;
  if (KNOWN_LOCAL_ONLY.has(key)) return false;
  if (routePath.includes("generate")) return true;
  if (routePath.startsWith("/api/batch")) return true;
  if (routePath.startsWith("/api/film/")) return true;
  if (routePath.startsWith("/api/audio/")) return true;
  if (routePath === "/api/assembly") return true;
  if (routePath === "/api/archive/persist") return true;
  if (routePath === "/api/archive/transcribe") return true;
  return false;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "target", "runtime"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (/\.(?:ts|tsx|js|mjs|rs)$/u.test(entry.name)) files.push(absolute);
  }
  return files;
}

test("fitness ratchet: a árvore inteira do app não reintroduz servidor gerativo", async () => {
  const appRoot = path.resolve(import.meta.dirname, "..", "app");
  const routePattern = /app\.(get|post)\(\s*'([^']+)'/g;
  const found = new Set();
  const forbiddenServerPatterns = [/from\s+["']express["']/u, /require\(["']express["']\)/u, /\/api\/(?:generate|film\/run|film\/resume|assembly|audio\/)/u];
  for (const file of await sourceFiles(appRoot)) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbiddenServerPatterns) {
      if (pattern.test(source)) found.add(`${path.relative(appRoot, file)}:${pattern.source}`);
    }
    for (const match of source.matchAll(routePattern)) {
      const method = match[1].toUpperCase();
      const routePath = match[2];
      if (looksGenerative(method, routePath)) found.add(`${method} ${routePath}`);
    }
  }

  const allowlist = new Set(GENERATIVE_ROUTE_ALLOWLIST);
  const newViolations = [...found].filter((entry) => !allowlist.has(entry));
  assert.deepEqual(
    newViolations,
    [],
    `Rota gerativa nova fora da allowlist congelada da Fase 0: ${newViolations.join(", ")}. ` +
      "Se é intencional, a Fase 2 (retirada do Express gerativo) é o lugar certo — não amplie a allowlist sem decisão explícita.",
  );

  // Não falha se a allowlist encolheu (é o objetivo da Fase 2) — só registra
  // o progresso para visibilidade.
  const remaining = [...allowlist].filter((entry) => found.has(entry));
  assert.ok(
    remaining.length <= GENERATIVE_ROUTE_ALLOWLIST.length,
    "contagem interna inconsistente",
  );
});
