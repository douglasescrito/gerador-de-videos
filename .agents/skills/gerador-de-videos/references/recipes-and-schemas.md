# Receitas, schemas e motion

Use os schemas e compiladores existentes em CORE. O formato do arquivo deve
corresponder ao comando: um JSON ilustrativo não comprova uma receita executável.
Leia o schema atual e valide antes de gerar. Não criar um segundo planner.

Dois exemplos neutros acompanham a skill: `../examples/commercial-film.json`
é um filme Studio visual de duas cenas (geração externa, sem narração); e
`../examples/flat-motion-render.json` é um preset geométrico Three.js local.
Os formatos são diferentes: o primeiro usa `dry-run --spec`, o segundo usa
`render --engine threejs --spec`. Não enviá-los a um comando de outro formato.

Para filme canônico: brief e contexto de conhecimento autorizado compilam para
film-spec e execution-plan, depois journal, adapters e recibos. O runtime não
refaz retrieval nem amplia direitos. Referências exigem autorização vigente.

Para conhecer receitas disponíveis, use o app ou a ajuda do comando `receitas`.
Preserve as receitas genéricas e técnicas reutilizáveis; substitua o conteúdo por
texto e recursos do próprio usuário. Nunca preencher automaticamente com uma marca.

## Primeiro render local

Em CORE, o preset geométrico não exige conta nem imagem:

```powershell
npm run video -- render --action engines
npm run video -- render --action render --mode studio --engine threejs --spec recipes/three-prism.render.json --collection primeiro-motion --dry-run true
npm run video -- render --action render --mode studio --engine threejs --spec recipes/three-prism.render.json --collection primeiro-motion --dry-run false
```

`three-orbit.render.json` e `three-gallery.render.json` oferecem outras composições.
A galeria geométrica não contém fotos; a autoria de uma galeria com imagens usa
os assets autorizados do usuário e o exemplo `examples/three-gallery-authoring.mjs`.

Use Three.js para cena, luzes e materiais; GSAP para movimentos; postprocessing
para bloom; Fiber/Drei para componentes; Theatre para keyframes e Quarks para
partículas. A receita detalhada está em `docs/THREE-DESIGN-STUDIO.md`.

Crie uma prévia leve, defina ritmo e destaque de cada imagem, congele a timeline,
adicione som e voz se pedidos e só então renderize o master. Para comparações,
varie estrutura, materiais, enquadramento e movimento de forma deliberada.
Não limitar o gerador à primeira receita nem carregar todas as libs em toda cena.
