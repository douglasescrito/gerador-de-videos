export async function executar(contexto) {
  const {
    runDoctor,
    endpoint,
  } = contexto;
  {
    await runDoctor(endpoint);
  }
}
