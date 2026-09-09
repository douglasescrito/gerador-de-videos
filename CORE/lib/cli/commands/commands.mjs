export async function executar(contexto) {
  const {
    listCommands,
    PROTECTED_COMMAND_IDS,
    CliError,
    ERROR_CODES,
    dicaDeSugestao,
    distanciaDeEdicao,
    resumoCurto,
    options,
  } = contexto;
  {
    // JSON continua sendo o padrão para agente. O que faltava era a mesma
    // lista legível por gente: 75 comandos e a única saída era um manifesto
    // de milhares de linhas, então "qual comando faz X?" não tinha resposta
    // sem abrir a documentação.
    const format = String(options.format ?? "json").toLowerCase();
    if (!["json", "texto"].includes(format)) throw new CliError("--format deve ser json ou texto.", { code: ERROR_CODES.USAGE });
    // Sem acento dos dois lados: quem procura "musica" quer achar "música",
    // e quem digita depressa não põe til.
    const semAcento = (texto) => String(texto).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const termo = options.buscar === undefined ? null : String(options.buscar).trim().toLowerCase();
    const alvo = termo == null ? null : semAcento(termo);
    const todos = listCommands();
    // Substring resolve a maioria; o resto é a mesma tolerância da sugestão
    // de comando — "musica" tem de achar "music", e "trilhas" tem de achar
    // "trilha".
    const casa = (entrada) => {
      const texto = semAcento(`${entrada.id} ${entrada.summary ?? ""}`);
      if (texto.includes(alvo)) return true;
      const limite = alvo.length >= 5 ? 1 : 0;
      if (!limite) return false;
      return texto.split(/[^a-z0-9]+/).some((palavra) => palavra.length >= 4 && distanciaDeEdicao(alvo, palavra, limite) <= limite);
    };
    const encontrados = alvo ? todos.filter(casa) : todos;
    if (format === "json") {
      console.log(JSON.stringify({ schema: "mkt-videos/cli-manifest@1", protectedCommands: [...PROTECTED_COMMAND_IDS], ...(termo ? { busca: termo } : {}), commands: encontrados }, null, 2));
    } else if (options.grupo !== undefined || (!termo && format === "texto")) {
      // Sem busca, a lista plana de 72 comandos não responde "o que existe
      // nessa área?". Agrupada, responde — e `--grupo <nome>` desce só na
      // família que interessa.
      const familia = options.grupo === undefined ? null : String(options.grupo).trim().toLowerCase();
      const familias = [...new Set(todos.map((entrada) => entrada.grupo))].sort();
      if (familia && !familias.includes(familia)) {
        throw new CliError(`Grupo desconhecido: ${familia}.`, {
          code: ERROR_CODES.USAGE,
          hint: dicaDeSugestao(familia, familias, { ondeProcurar: `Grupos: ${familias.join(", ")}.` }),
        });
      }
      const visiveis = familia ? encontrados.filter((entrada) => entrada.grupo === familia) : encontrados;
      const largura = Math.max(...visiveis.map((entrada) => entrada.id.length));
      for (const nome of familia ? [familia] : familias) {
        const daFamilia = visiveis.filter((entrada) => entrada.grupo === nome);
        if (!daFamilia.length) continue;
        console.log(`
${nome}`);
        for (const entrada of daFamilia) {
          console.log(`  ${entrada.id.padEnd(largura)}  ${resumoCurto(entrada)}`);
        }
      }
      console.log(`
Só uma família: npm run video -- commands --grupo <${familias.join("|")}>`);
      console.log(`Detalhe de um comando: npm run video -- <comando> --help`);
    } else if (!encontrados.length) {
      console.log(`Nenhum comando casa com "${termo}".`);
      const proximos = dicaDeSugestao(termo, todos.map((entrada) => entrada.id), { ondeProcurar: null });
      if (proximos) console.log(proximos);
      process.exitCode = 1;
    } else {
      const largura = Math.max(...encontrados.map((entrada) => entrada.id.length));
      if (termo) console.log(`${encontrados.length} de ${todos.length} comandos casam com "${termo}":
`);
      for (const entrada of encontrados) {
        // Uma linha por comando: o nome e o que ele faz. O detalhe fica no
        // --help do próprio comando, que já é bom.
        console.log(`  ${entrada.id.padEnd(largura)}  ${resumoCurto(entrada)}`);
      }
      console.log(`
Detalhe de um comando: npm run video -- <comando> --help`);
    }
  }
}
