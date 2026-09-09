export async function executar(contexto) {
  const {
    handleRecipeCommand,
    options,
  } = contexto;
  {
    await handleRecipeCommand(options);
  }
}
