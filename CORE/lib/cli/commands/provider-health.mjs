export async function executar(contexto) {
  const {
    probeProviderRegistry,
    endpoint,
  } = contexto;
  {
    const registry = await probeProviderRegistry({ probes: {
      "gemini-omni": async () => {
        const response = await fetch(`${endpoint}/health`);
        const payload = await response.json().catch(() => ({}));
        return { ready: response.ok && payload.ready !== false, status: payload.status ?? (response.ok ? "ready" : `http_${response.status}`) };
      },
    } });
    console.log(JSON.stringify(registry, null, 2));
  }
}
