# Plugins da Mesa de Produção

Esta pasta recebe plugins Wasm locais para a Mesa de Produção. Cada plugin fica
em um diretório próprio e precisa conter `mesa-plugin.json` e um módulo `.wasm`
com SHA-256 exato.

Os três módulos e seus fontes Rust são recursos de desenvolvimento. O host
Wasmtime descrito no contrato não está integrado ao app/CLI atual. Copiar esta
pasta não ativa plugins no formulário. Os módulos não importam serviços do host
e produzem somente JSON; nenhuma geração é executada por eles.

Veja o estado atual, a compilação e o contrato em
[PLUGIN-RUNTIME.md](../docs/PLUGIN-RUNTIME.md).
