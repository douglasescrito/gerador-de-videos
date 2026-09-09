#!/usr/bin/env node
/**
 * CLI do Minerador de Prompts Grok (xAI via X/Twitter)
 *
 * Usa o cliente real do X MEDIA quando --live true,
 * lendo cookies do Windows Credential Manager (x-media-fetcher:primary:cookies).
 *
 * Uso:
 *   node scripts/grok-prompt-miner-cli.mjs --brief "..." --media video --count 4 --live true
 *   node scripts/grok-prompt-miner-cli.mjs --doctor
 */
import { parseArgs } from "node:util";
import { minePromptsWithGrok, checkXMediaCookieStatus, DEFAULT_GROK_MODEL } from "../lib/media-pipeline/grok-prompt-miner.mjs";
import { writeFileSync } from "node:fs";

function printHelp() {
  console.log(`
Uso do Minerador de Prompts Grok:
  node scripts/grok-prompt-miner-cli.mjs --brief "Descrição" [opções]

Opções:
  --brief <texto>          Briefing curto para mineração (obrigatório)
  --media <video|image>   Tipo de mídia alvo (padrão: video)
  --style <estilo>        Preset de estilo visual (opcional)
  --count <número>        Quantidade de prompts a gerar (padrão: 3)
  --model <id>            Modelo Grok a usar (padrão: ${DEFAULT_GROK_MODEL})
  --live <bool>   Acionar o Grok real via X MEDIA (padrão: false = modo dublê)
  --dublee <bool>         Forçar modo dublê mesmo com --live true (padrão: false)
  --out <caminho.json>    Caminho para salvar o resultado em JSON
  --doctor                Verificar status das credenciais do X no Credential Manager

Modelos disponíveis:
  grok-4            → Rota browser legada; seleção remota de modelo não verificada
  grok-3-latest     → Grok 3 (via HTTP direto — mais rápido)

Nota: a rota browser usa playwright-core do gerador e o Chrome local.

Modo real:
  Requer cookies válidos no Windows Credential Manager.
  Consulte docs/GROK-OPCIONAL.md para configurar sua própria sessão e adapter.

Modo dublê (padrão):
  Gera prompts sem conexão. Útil para testes e banco inicial.
`);
}

async function runDoctor() {
  console.log(`\n🔍 Verificando credenciais do Grok (X MEDIA)...\n`);
  console.log(`🤖 Modelo padrão: ${DEFAULT_GROK_MODEL}\n`);
  const status = checkXMediaCookieStatus();
  if (!status.configured) {
    console.log("❌ Credenciais NÃO encontradas no Windows Credential Manager.");
    console.log("\nPara configurar:");
    console.log("  Consulte docs/GROK-OPCIONAL.md para configurar sua própria sessão e adapter.");
    console.log("  A configuração do Grok é opcional e não ativa os provedores Google.");
    process.exitCode = 1;
  } else {
    console.log("✅ Credenciais encontradas!");
    console.log(`   Cookies: ${status.cookieCount}`);
    console.log(`   auth_token: ${status.hasAuthToken ? "✔" : "✖"}`);
    console.log(`   ct0: ${status.hasCt0 ? "✔" : "✖"}`);
    console.log("\n👍 Cookies encontrados. O adapter e o acesso remoto ainda precisam estar disponíveis; --live true seleciona execução real.");
  }
  console.log();
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        brief: { type: "string" },
        media: { type: "string", default: "video" },
        style: { type: "string" },
        count: { type: "string", default: "3" },
        model: { type: "string", default: DEFAULT_GROK_MODEL },
        "live": { type: "string", default: "false" },
        dublee: { type: "string", default: "false" },
        out: { type: "string" },
        doctor: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    console.error(`[Grok Miner Error] ${error.message}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const { values } = parsed;

  if (values.help) { printHelp(); return; }
  if (values.doctor) { await runDoctor(); return; }

  if (!values.brief) {
    console.error("[Grok Miner] --brief é obrigatório.");
    printHelp();
    process.exitCode = 1;
    return;
  }

  const isDublee = String(values.dublee) === "true";
  const isLive = String(values["live"]) === "true";

  if (isLive && !isDublee) {
    console.error(`[Grok Miner] Acionando modo REAL via X MEDIA | Modelo: ${values.model}...`);
  }

  try {
    const result = await minePromptsWithGrok({
      brief: values.brief,
      targetMedia: values.media,
      style: values.style ?? null,
      count: Number(values.count) || 3,
      model: values.model,
      dublee: isDublee || !isLive,
    });

    const jsonOutput = JSON.stringify(result, null, 2);
    if (values.out) {
      writeFileSync(values.out, jsonOutput, "utf-8");
      console.error(`[Grok Miner] Prompts salvos em: ${values.out}`);
    }
    console.log(jsonOutput);
  } catch (error) {
    console.error(`[Grok Miner Error] ${error.message}`);
    process.exitCode = 1;
  }
}

main();
