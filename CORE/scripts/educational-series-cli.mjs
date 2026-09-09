import path from "node:path";
import {
  assembleEpisode,
  bootstrapSeries,
  claimNextEpisode,
  markEpisodeAttention,
  prepareEpisode,
  readSeriesStatus,
} from "../lib/educational-series/runner.mjs";

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Argumento inesperado: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value == null || value.startsWith("--")) options[key] = true;
    else {
      options[key] = value;
      index += 1;
    }
  }
  return { command, options };
}

function help() {
  return `Runner de séries educativas

  npm run series -- bootstrap --series series/minha-serie
  npm run series -- status --series series/minha-serie
  npm run series -- claim --series series/minha-serie
  npm run series -- prepare --series series/minha-serie --claim-token <token> --brief <episode-brief.json>
  npm run series -- assemble --series series/minha-serie --claim-token <token>
  npm run series -- attention --series series/minha-serie --claim-token <token> --reason <motivo>

O comando não pesquisa nem inventa fatos. A automação Codex pesquisa fontes oficiais,
cria o briefing e usa este runner para garantir fila, não repetição, montagem e recibos.`;
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command !== "help" && !options.help && (typeof options.series !== "string" || !options.series.trim())) throw new Error("--series é obrigatório; consulte help.");
const seriesDir = options.series ? path.resolve(options.series) : null;

let result;
if (command === "help" || options.help) result = { help: help() };
else if (command === "bootstrap") result = await bootstrapSeries({ seriesDir });
else if (command === "status") result = await readSeriesStatus({ seriesDir });
else if (command === "claim") result = await claimNextEpisode({ seriesDir });
else if (command === "prepare") result = await prepareEpisode({
  seriesDir,
  claimToken: options["claim-token"],
  briefFile: options.brief,
});
else if (command === "assemble") result = await assembleEpisode({
  seriesDir,
  claimToken: options["claim-token"],
});
else if (command === "attention") result = await markEpisodeAttention({
  seriesDir,
  claimToken: options["claim-token"],
  reason: options.reason,
});
else throw new Error(`Comando desconhecido: ${command}`);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

