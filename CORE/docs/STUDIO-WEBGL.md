# WebGL 2 no renderer Studio

Recursos Three.js, presets executáveis, bibliotecas pinadas, captura leve e receita
da galeria premium: [Three Design Studio](THREE-DESIGN-STUDIO.md).

O renderer HTML existente aceita `scene.graphicsApi: "webgl2"` para documentos locais explicitamente solicitados em 3D. O padrão continua sendo Canvas 2D. A opção usa Playwright headless com ANGLE/D3D11 no Windows; não cria outro executor, servidor ou caminho de geração.

O documento deve incorporar as dependências e os recursos necessários. A composição e o próprio código do renderer entram no vínculo por hash. Rede, cookies, subdocumentos, fontes não declaradas e downloads continuam bloqueados. WebGL 1 e outras APIs gráficas não são liberados por essa opção.

Cada frame recebe o tempo explícito da timeline. O renderer espera a GPU e a pintura do navegador, verifica perda de contexto e erros de WebGL e publica a identificação da implementação gráfica no recibo. A reprodução visual em outra GPU ou versão de driver não implica identidade binária; use os dados do recibo para comparar o ambiente.

O teste `test/html-webgl.test.mjs` verifica a opção explícita, frames diferentes, repetibilidade local, bloqueio de acesso ao documento pai e de rede. `test/html-motion-pilot.test.mjs` mantém a cobertura do caminho 2D e de retomada.

Use as dependências pinadas do projeto e as fontes redistribuíveis instaladas.
Imagens e logotipos de cada produção são entradas próprias e explícitas, com os
vínculos e direitos correspondentes. Nenhuma mídia da produção original acompanha
este exemplo técnico.

Referências técnicas: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) e [RoomEnvironment](https://threejs.org/docs/pages/RoomEnvironment.html).
