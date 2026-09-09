#!/usr/bin/env node
/**
 * Gerador de Banco Local de Prompts de Marketing
 *
 * Usa o Grok Prompt Miner para gerar e persistir um banco estruturado
 * de prompts de vídeo e imagem para uso em campanhas de marketing.
 *
 * Uso:
 *   node scripts/prompt-bank-builder.mjs [--out <caminho.json>] [--categories <lista>]
 */
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minePromptsWithGrok } from "../lib/media-pipeline/grok-prompt-miner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Catálogo de Briefings por Categoria de Marketing ─────────────────────────
const MARKETING_CATALOG = [
  // PRODUTO / LANÇAMENTO
  {
    category: "produto",
    subcategory: "lançamento",
    briefs: [
      "Luxury skincare product floating in soft diffused light, elegant studio background",
      "Tech gadget unboxing reveal in cinematic slow motion, premium packaging",
      "Artisan coffee product on marble surface with steam rising, warm golden tones",
      "High-end perfume bottle with light refractions, luxury brand aesthetic",
      "Athletic shoe rotating in mid-air with dynamic energy and speed lines",
    ],
  },
  // LIFESTYLE / ASPIRACIONAL
  {
    category: "lifestyle",
    subcategory: "aspiracional",
    briefs: [
      "Successful professional in modern office looking at city skyline at sunset",
      "Young entrepreneur working on laptop in minimalist cozy home studio",
      "Healthy morning routine: person enjoying smoothie in bright modern kitchen",
      "Couple traveling in convertible car along coastal road at golden hour",
      "Athlete finishing marathon crossing finish line with crowd celebrating",
    ],
  },
  // MARCA / INSTITUCIONAL
  {
    category: "marca",
    subcategory: "institucional",
    briefs: [
      "Company logo reveal with elegant particle animation and gold premium feel",
      "Corporate team collaboration in modern glass building, diverse professionals",
      "Innovative technology startup office with holographic displays and futuristic design",
      "Sustainable brand showcasing eco-friendly packaging in natural green environment",
      "Brand heritage storytelling with vintage factory transforming into modern facility",
    ],
  },
  // ALIMENTAÇÃO / F&B
  {
    category: "alimentacao",
    subcategory: "gastronomia",
    briefs: [
      "Gourmet burger with fresh ingredients falling in slow motion, food photography",
      "Artisan pizza fresh from wood-fired oven with cheese pull and steam",
      "Craft beer being poured with perfect foam in dim tavern ambiance lighting",
      "Fresh fruit smoothie bowl with superfoods arranged in aesthetic overhead shot",
      "Chocolate being poured over luxury dessert with warm studio macro lighting",
    ],
  },
  // MODA / VESTUÁRIO
  {
    category: "moda",
    subcategory: "vestuario",
    briefs: [
      "Fashion model walking runway with dramatic lighting and flowing fabric in slow motion",
      "Luxury handbag closeup with premium leather texture in elegant studio light",
      "Streetwear brand campaign with urban graffiti background and natural light",
      "Sustainable fashion clothing line with outdoor nature backdrop and soft pastel tones",
      "Athletic performance wear in motion capture during intense training session",
    ],
  },
  // IMÓVEIS / ARQUITETURA
  {
    category: "imoveis",
    subcategory: "arquitetura",
    briefs: [
      "Luxury penthouse interior with floor-to-ceiling windows and city skyline at dusk",
      "Modern minimalist home exterior with pool and manicured garden at golden hour",
      "Real estate aerial drone shot of premium coastal property with ocean view",
      "Cozy apartment interior with warm lighting, plants and modern scandinavian design",
      "Commercial office building reveal with time-lapse of construction to completion",
    ],
  },
  // AUTOMOTIVO
  {
    category: "automotivo",
    subcategory: "veiculos",
    briefs: [
      "Electric sports car drifting on empty mountain road with cinematic wide shot",
      "Luxury SUV driving through rain-soaked city streets with neon reflections",
      "Classic muscle car engine reveal with smoke and dramatic low angle shot",
      "Off-road vehicle conquering muddy terrain with water spray and dust clouds",
      "Futuristic autonomous vehicle in urban smart city environment with blue ambient lighting",
    ],
  },
  // SAÚDE / BEM-ESTAR
  {
    category: "saude",
    subcategory: "bemestar",
    briefs: [
      "Yoga practitioner at sunrise on mountain peak with ethereal mist and soft light",
      "Modern gym workout montage with dynamic lighting and athletic movement",
      "Meditation space with candles, plants and soft morning window light",
      "Health supplement product with natural ingredients on clean white background",
      "Spa and wellness center with water features, stone design and relaxing atmosphere",
    ],
  },
  // TECNOLOGIA
  {
    category: "tecnologia",
    subcategory: "digital",
    briefs: [
      "Futuristic AI interface with glowing data streams and holographic displays",
      "Smartphone closeup with app interface animation and cinematic depth of field",
      "Smart home devices in modern living room with soft ambient connectivity lights",
      "Software developer coding with multiple screens showing elegant code and data",
      "Cybersecurity concept with digital shield and encrypted data visualization",
    ],
  },
  // ENTRETENIMENTO / EVENTOS
  {
    category: "entretenimento",
    subcategory: "eventos",
    briefs: [
      "Concert stage reveal with epic lighting rig and crowd energy at night",
      "VIP event lounge with premium cocktails, ambient lighting and elegant guests",
      "Sports championship victory celebration with confetti and stadium crowd",
      "Festival atmosphere with colorful lights, happy crowd and music energy",
      "Gala award ceremony with red carpet, spotlights and glamorous atmosphere",
    ],
  },
];

const STYLES = ["cinematic-default", "photorealistic", "editorial", "luxury-brand", "lifestyle-warm"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function now() {
  return new Date().toISOString();
}

function buildBankPath(outDir) {
  mkdirSync(outDir, { recursive: true });
  return join(outDir, "prompt-bank.json");
}

function loadExistingBank(bankPath) {
  if (existsSync(bankPath)) {
    try {
      return JSON.parse(readFileSync(bankPath, "utf-8"));
    } catch {
      throw new Error("Banco existente inválido; arquivo preservado. Escolha outro destino ou recupere o banco.");
    }
  }
  return null;
}

// ─── Geração do Banco ─────────────────────────────────────────────────────────
async function buildPromptBank({ outDir, categories = null, videoCount = 3, imageCount = 3, live = false, delayMs = 0 }) {
  const bankPath = buildBankPath(outDir);
  const existing = loadExistingBank(bankPath);

  const bank = existing ?? {
    schema: "mkt-videos/prompt-bank@1",
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    totalEntries: 0,
    categories: {},
  };

  const catalog = categories
    ? MARKETING_CATALOG.filter((c) => categories.includes(c.category))
    : MARKETING_CATALOG;

  let added = 0;
  let failed = 0;
  let total = catalog.length * 5; // 5 briefs por categoria
  let processed = 0;

  console.log(`\n🏗️  Banco de Prompts de Marketing — Iniciando geração`);
  console.log(`📂 Destino: ${bankPath}`);
  console.log(`📦 Categorias: ${catalog.map((c) => c.category).join(", ")}`);
  console.log(`🎬 Vídeo: ${videoCount} variações por brief | 🖼️  Imagem: ${imageCount} variações por brief`);
  console.log(`⚙️  Modo: ${live ? "🔴 GROK REAL (adapter configurado)" : "🟡 Dublê (templates locais)"}\n`);

  for (const categoryDef of catalog) {
    const { category, subcategory, briefs } = categoryDef;
    if (!bank.categories[category]) {
      bank.categories[category] = {
        label: category,
        subcategory,
        entries: [],
      };
    }

    for (const brief of briefs) {
      processed++;
      const pct = Math.round((processed / total) * 100);
      const styleIndex = processed % STYLES.length;
      const style = STYLES[styleIndex];

      process.stdout.write(`[${pct}%] ⛏  ${category}/${subcategory} | "${brief.slice(0, 60)}..." `);

      try {
        // Minerar prompts de vídeo
        const videoResult = await minePromptsWithGrok({
          brief,
          targetMedia: "video",
          style,
          count: videoCount,
          dublee: !live,
          live,
        });

        // Delay entre chamadas ao Grok real para não sobrecarregar
        if (live && delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }

        // Minerar prompts de imagem
        const imageResult = await minePromptsWithGrok({
          brief,
          targetMedia: "image",
          style,
          count: imageCount,
          dublee: !live,
          live,
        });

        // Delay entre briefs
        if (live && delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }

        const entry = {
          id: `entry-${category}-${bank.categories[category].entries.length + 1}`,
          brief,
          category,
          subcategory,
          style,
          minedAt: now(),
          video: videoResult.prompts,
          image: imageResult.prompts,
          receipts: {
            video: videoResult.receipt,
            image: imageResult.receipt,
          },
        };

        bank.categories[category].entries.push(entry);
        added++;
        console.log(`✔ (${videoResult.prompts.length}v + ${imageResult.prompts.length}i)`);
      } catch (error) {
        failed++;
        console.log(`✖ ${error.message}`);
      }
    }
  }

  bank.updatedAt = now();
  bank.totalEntries = Object.values(bank.categories).reduce((sum, c) => sum + c.entries.length, 0);

  writeFileSync(bankPath, JSON.stringify(bank, null, 2), "utf-8");

  console.log(failed ? `\nBanco parcial: ${added} entradas adicionadas; ${failed} falhas.` : `\n✅ Banco gerado com sucesso!`);
  if (failed) process.exitCode = 1;
  console.log(`📊 Total de entries: ${bank.totalEntries}`);
  console.log(`📁 Arquivo: ${bankPath}\n`);

  // Sumário por categoria
  console.log("📋 Sumário por categoria:");
  for (const [cat, data] of Object.entries(bank.categories)) {
    const totalPrompts = data.entries.reduce(
      (s, e) => s + e.video.length + e.image.length,
      0
    );
    console.log(`   ${cat.padEnd(16)} → ${data.entries.length} briefs | ${totalPrompts} prompts`);
  }

  return bank;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: "outputs/prompt-bank" },
      categories: { type: "string" },
      "video-count": { type: "string", default: "4" },
      "image-count": { type: "string", default: "4" },
      "live": { type: "string", default: "false" },
      "delay-ms": { type: "string", default: "2000" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
Uso: node scripts/prompt-bank-builder.mjs [opções]

Opções:
  --out <pasta>              Pasta de destino do banco (padrão: outputs/prompt-bank)
  --categories <cat1,cat2>   Filtrar por categorias (ex: produto,lifestyle,moda)
  --video-count <n>          Variações de vídeo por brief (padrão: 4)
  --image-count <n>          Variações de imagem por brief (padrão: 4)
  --live <bool>      Usar Grok real via adapter configurado (padrão: false = modo dublê)
  --delay-ms <n>             Delay entre chamadas ao Grok real, em ms (padrão: 2000)

Categorias disponíveis:
  produto, lifestyle, marca, alimentacao, moda,
  imoveis, automotivo, saude, tecnologia, entretenimento

Exemplo com Grok real:
  node scripts/prompt-bank-builder.mjs --categories produto --live true --video-count 3 --image-count 3
`);
    return;
  }

  const outDir = resolve(dirname(__dirname), values.out);
  const categories = values.categories ? values.categories.split(",").map((c) => c.trim()) : null;
  const videoCount = Number(values["video-count"]) || 4;
  const imageCount = Number(values["image-count"]) || 4;
  const live = String(values["live"]) === "true";
  const delayMs = Number(values["delay-ms"]) || 2000;

  if (!["true", "false"].includes(values.live)) throw new Error("--live aceita true ou false.");
  for (const key of ["video-count", "image-count"]) {
    const count = Number(values[key]);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error(`--${key} exige inteiro entre 1 e 10.`);
  }
  if (categories?.some(category => !MARKETING_CATALOG.some(entry => entry.category === category))) throw new Error("Categoria desconhecida; consulte --help.");

  await buildPromptBank({ outDir, categories, videoCount, imageCount, live, delayMs });
}

main().catch((error) => {
  console.error(`[Prompt Bank Error] ${error.message}`);
  process.exitCode = 1;
});

