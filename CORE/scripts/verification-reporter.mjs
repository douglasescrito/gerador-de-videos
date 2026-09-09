// Relatório estruturado adicional. O reporter spec e o exit code do Node
// continuam sendo a saída humana e a autoridade do resultado dos testes.
export default async function* report(source) {
  for await (const event of source) {
    const { type, data } = event;
    if (["test:pass", "test:fail"].includes(type)) {
      yield `${JSON.stringify({ type, file: data.file, name: data.name, nesting: data.nesting,
        durationMs: data.details?.duration_ms, skipped: data.skip ?? false,
        failure: data.details?.error?.message })}\n`;
    }
    if (type === "test:summary") yield `${JSON.stringify({ type, ...data })}\n`;
  }
}
