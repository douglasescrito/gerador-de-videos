// "Você quis dizer" para comando e opção.
//
// Digitar `generat` despejava 147 linhas de ajuda sem dizer que o comando não
// existe; digitar `--promptt` dizia o que estava errado mas não o que era
// certo. São 75 comandos e dezenas de opções por comando — a distância entre
// o que se digitou e o que existe quase sempre é de uma letra, e o CLI tinha
// essa informação sem usá-la.

/**
 * Distância de edição com corte: para de contar assim que passa do limite,
 * porque a resposta acima dele é sempre a mesma — "não é parecido".
 */
export function distanciaDeEdicao(esquerda, direita, limite = Infinity) {
  const a = String(esquerda);
  const b = String(direita);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, indice) => indice);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let menorDaLinha = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      if (atual[j] < menorDaLinha) menorDaLinha = atual[j];
    }
    if (menorDaLinha > limite) return limite + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Candidatos mais próximos da entrada, do mais próximo ao menos.
 *
 * O limite cresce com o tamanho da palavra: uma letra errada em `run` não é
 * a mesma coisa que uma letra errada em `daily-commercials`. Prefixo conta
 * como parecido mesmo quando a distância é grande — quem digita `flow` está
 * procurando `flow-video`, não errando uma letra.
 */
export function sugerir(entrada, candidatos, { maximo = 3 } = {}) {
  const alvo = String(entrada ?? "").trim().toLowerCase();
  if (!alvo) return [];
  const limite = Math.max(2, Math.floor(alvo.length / 3));
  const pontuados = [];
  for (const bruto of candidatos ?? []) {
    const candidato = String(bruto);
    const normalizado = candidato.toLowerCase();
    if (normalizado === alvo) continue;
    const prefixo = normalizado.startsWith(alvo) || alvo.startsWith(normalizado);
    const distancia = distanciaDeEdicao(alvo, normalizado, limite);
    if (!prefixo && distancia > limite) continue;
    // Prefixo vem antes de qualquer distância, e entre prefixos vale o mais
    // próximo em tamanho: quem digita `prompt-fil` quer `--prompt-file`,
    // não `--prompt`, ainda que os dois casem como prefixo.
    pontuados.push({ candidato, ordem: prefixo ? -1000 + Math.abs(normalizado.length - alvo.length) : distancia });
  }
  return pontuados
    .sort((esquerda, direita) => esquerda.ordem - direita.ordem || esquerda.candidato.localeCompare(direita.candidato))
    .slice(0, maximo)
    .map((entrada) => entrada.candidato);
}

/**
 * A frase pronta. Quando não há nada parecido, aponta para onde procurar em
 * vez de deixar a pessoa sozinha.
 */
export function dicaDeSugestao(entrada, candidatos, { prefixo = "", ondeProcurar = null } = {}) {
  const proximos = sugerir(entrada, candidatos);
  if (proximos.length === 1) return `Você quis dizer ${prefixo}${proximos[0]}?`;
  if (proximos.length > 1) return `Você quis dizer ${proximos.map((nome) => `${prefixo}${nome}`).join(", ")}?`;
  return ondeProcurar;
}
