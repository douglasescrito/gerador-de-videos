#!/usr/bin/env node
/**
 * Consulta o Banco Local de Prompts de Marketing
 *
 * Uso:
 *   node scripts/prompt-bank-query.mjs --category produto --media video
 *   node scripts/prompt-bank-query.mjs --list-categories
 *   node scripts/prompt-bank-query.mjs --random --media image --count 5
 */
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadBank(bankPath) {
  if (!existsSync(bankPath)) {
    throw new Error(`Banco não encontrado em: ${bankPath}\nRode primeiro: npm run prompt:bank`);
  }
  return JSON.parse(readFileSync(bankPath, "utf-8"));
}

function printPrompts(prompts, media, maxCount) {
  const list = maxCount ? prompts.slice(0, maxCount) : prompts;
  for (const p of list) {
    console.log(`\n  [${media} #${p.variant}] ${p.brief ? `Brief: "${p.brief.slice(0, 50)}..."` : ""}`);
    console.log(`  Style: ${p.style}`);
    console.log(`  ──────────────────────────────────────────`);
    console.log(`  ${p.effectivePrompt}`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      bank: { type: "string", default: "outputs/prompt-bank/prompt-bank.json" },
      category: { type: "string" },
      media: { type: "string", default: "video" },
      count: { type: "string", default: "3" },
      random: { type: "boolean" },
      "list-categories": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
Uso: node scripts/prompt-bank-query.mjs [opções]

Opções:
  --category <nome>       Filtrar por categoria
  --media <video|image>   Tipo de mídia (padrão: video)
  --count <n>             Número máximo de prompts exibidos (padrão: 3)
  --random                Retornar prompts aleatórios
  --list-categories       Listar todas as categorias disponíveis
  --bank <caminho>        Caminho do banco (padrão: outputs/prompt-bank/prompt-bank.json)
`);
    return;
  }

  const bankPath = resolve(dirname(__dirname), values.bank);
  const bank = loadBank(bankPath);
  const media = String(values.media).toLowerCase() === "image" ? "image" : "video";
  const maxCount = Number(values.count) || 3;

  // Listar categorias
  if (values["list-categories"]) {
    console.log(`\n📦 Banco: ${bank.schema} (${bank.totalEntries} entries, atualizado ${bank.updatedAt.slice(0, 10)})\n`);
    console.log("Categorias disponíveis:\n");
    for (const [cat, data] of Object.entries(bank.categories)) {
      const total = data.entries.reduce((s, e) => s + e.video.length + e.image.length, 0);
      console.log(`  ${cat.padEnd(16)} │ ${data.entries.length} briefs │ ${total} prompts (${data.subcategory})`);
    }
    console.log();
    return;
  }

  // Buscar prompts
  let allPrompts = [];

  const categoriesToSearch = values.category
    ? [bank.categories[values.category]].filter(Boolean)
    : Object.values(bank.categories);

  if (!categoriesToSearch.length) {
    console.error(`Categoria não encontrada: ${values.category}`);
    process.exitCode = 1;
    return;
  }

  for (const cat of categoriesToSearch) {
    for (const entry of cat.entries) {
      const prompts = (media === "video" ? entry.video : entry.image).map((p) => ({
        ...p,
        brief: entry.brief,
        category: entry.category,
        subcategory: entry.subcategory,
      }));
      allPrompts.push(...prompts);
    }
  }

  if (values.random) {
    // Embaralhar
    for (let i = allPrompts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allPrompts[i], allPrompts[j]] = [allPrompts[j], allPrompts[i]];
    }
  }

  const categoryLabel = values.category ?? "todas as categorias";
  console.log(`\n🎬 Banco de Prompts — ${media.toUpperCase()} | ${categoryLabel} | mostrando ${Math.min(maxCount, allPrompts.length)} de ${allPrompts.length}\n`);

  printPrompts(allPrompts, media, maxCount);
  console.log();
}

main().catch((error) => {
  console.error(`[Prompt Bank Query Error] ${error.message}`);
  process.exitCode = 1;
});

