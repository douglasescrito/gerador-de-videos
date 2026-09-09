# Runtime de plugins do Gerador de Vídeos

## Objetivo

Estado atual: o pacote inclui três módulos Wasm, fontes Rust e lockfiles. O
host Wasmtime e a integração com o formulário não estão presentes no app/CLI
atual. As regras de host abaixo são um contrato para a integração futura, não
garantias implementadas por esses módulos isoladamente. Os testes locais
verificam ABI, ausência de imports, hashes e respostas dos módulos em Node.

Para recompilar um módulo, instale Rust com o target `wasm32-unknown-unknown`
e execute, em sua pasta, `cargo build --locked --release --target
wasm32-unknown-unknown`. Copie o `.wasm` de `target/wasm32-unknown-unknown/release/`
para `plugin.wasm` e atualize `wasmSha256` no manifesto. Antes de distribuir,
remapeie caminhos locais com `--remap-path-prefix` em `CARGO_ENCODED_RUSTFLAGS`
e verifique que o binário não contém caminhos de usuário.

Permitir extensões locais de cálculo, leitura de metadados e transformação
proposta de prompt Studio sem conceder acesso ao sistema ou ao provedor. Plugins
não podem executar geração, alterar o modo `raw`, consumir cota ou promover
conhecimento.

## Manifesto

Cada plugin vive em `CORE/plugins/<id>/` ou em
`%LOCALAPPDATA%\MktVideos\Mesa\plugins\<id>\`.

```json
{
  "schema": "mkt-videos/plugin-manifest@1",
  "id": "meu-plugin",
  "name": "Meu plugin",
  "version": "1.0.0",
  "wasm": "plugin.wasm",
  "wasmSha256": "<sha256 hexadecimal de 64 caracteres>",
  "capabilities": ["studio:prompt-transform"]
}
```

Capabilities aceitas:

- `utility:compute`
- `metadata:read`
- `studio:prompt-transform`

Qualquer capability desconhecida, caminho absoluto, travessia de diretório,
symlink para fora da raiz ou hash divergente invalida o plugin.

## ABI `mesa-plugin@1`

O módulo exporta:

- `memory`: memória linear;
- `mesa_plugin_api_version() -> i32`: precisa retornar `1`;
- `alloc(input_len: i32) -> i32`: reserva a entrada e devolve seu offset;
- `run(input_ptr: i32, input_len: i32) -> i64`.

O host grava o JSON no offset devolvido por `alloc`. `run` devolve um `i64` empacotado:
os 32 bits altos são o offset da saída e os 32 bits baixos são o tamanho. A
saída deve ser JSON UTF-8 válido.

## Limites e segurança

- Wasmtime sem WASI e sem imports fornecidos;
- rede e filesystem indisponíveis;
- memória máxima de 16 MiB;
- entrada e saída máximas de 256 KiB;
- 2.000.000 unidades de fuel por execução;
- chaves sensíveis (`auth`, `authorization`, `cookie`, `secret`, `sesskey`,
  `token`) bloqueadas antes e depois do Wasm;
- execução exige confirmação explícita;
- recibo da execução informa `providerCalls: 0` e
  `requiresHumanReview: true`.

Uma saída `{ "userPrompt": "..." }` pode ser transferida para o formulário
Studio. Ela não dispara geração: o usuário ainda revisa o prompt, escolhe o
preset e solicita a geração. Não existe confirmação de gasto; a confirmação
de entrada externa continua necessária quando houver referências.
