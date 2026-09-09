// Primitivas de paralelismo com ordem preservada.
//
// Duas garantias que o pipeline depende e que `Promise.all` cru não dá:
//
//  1. o resultado sai na ordem da entrada, sempre — a montagem depende de bloco
//     n01 vir antes de n02, e o tempo de resposta do provedor não pode decidir
//     a ordem editorial;
//  2. na primeira falha, nenhum trabalho novo começa, mas o que já estava em voo
//     termina antes do erro subir — evita ffmpeg e Whisper órfãos segurando GPU.

import os from "node:os";

export function resolveCpuConcurrency(requested, itemCount, { cap = 4 } = {}) {
  const total = Math.max(1, Number(itemCount) || 1);
  const asked = Number(requested);
  if (Number.isInteger(asked) && asked > 0) return Math.min(asked, total);
  const cores = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length ?? 2) - 1);
  return Math.max(1, Math.min(total, cores, cap));
}

export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.from(items ?? []);
  if (typeof worker !== "function") throw new Error("mapWithConcurrency exige uma função de trabalho.");
  if (!list.length) return [];
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let cursor = 0;
  let failure = null;

  const run = async () => {
    while (cursor < list.length && failure == null) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(list[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  };

  await Promise.all(Array.from({ length: width }, run));
  if (failure) throw failure;
  return results;
}

/** Fila com largura fixa. Usada onde o recurso é único (a VRAM, por exemplo). */
export function createLimiter(limit) {
  const width = Math.max(1, Number(limit) || 1);
  let active = 0;
  const waiting = [];

  function next() {
    if (active >= width || waiting.length === 0) return;
    active += 1;
    const { work, resolve, reject } = waiting.shift();
    Promise.resolve().then(work).then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
  }

  return Object.freeze({
    get width() { return width; },
    get pending() { return waiting.length; },
    get active() { return active; },
    run(work) {
      return new Promise((resolve, reject) => {
        waiting.push({ work, resolve, reject });
        next();
      });
    },
  });
}
