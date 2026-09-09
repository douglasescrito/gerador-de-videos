# Pesquisa audiovisual orientada por React

Este recurso testa como o Gemini Omni interpreta código React/JSX, CSS, estados,
timelines, narração e efeitos sonoros como direção audiovisual.

## Recurso reutilizável

O estilo Studio `react-audiovisual@1` preserva a hierarquia e a intenção do
código, solicita geometria estável, composição contemporânea e sincroniza
narração ou efeitos somente quando eles estiverem declarados no prompt.
Quando existe uma imagem de referência, ela permanece orientação generativa
fora da tela: salvo uso humano explícito de `<FIRST_FRAME>`, o frame zero já
deve ser o primeiro estado do movimento, nunca a referência piscando, um poster
frame, uma prévia ou uma composição posterior.

Para um clipe:

```powershell
npm run video -- generate --mode studio --style react-audiovisual@1 --prompt-file cena.jsx --aspect 16:9 --collection nome
```

## Padrão para testes e pesquisa

Para uma pesquisa com vários clipes, usar o perfil:

```powershell
npm run video -- batch --jobs jobs.json --research-profile react-audiovisual@1 --parallel 3 --out-dir outputs/nome-da-pesquisa
```

O perfil aplica `mode=studio` e `style=react-audiovisual@1` quando esses campos
não forem definidos nos jobs. O batch continua fazendo uma única chamada por
clipe e nunca cria rodadas corretivas.

Quando todos os jobs terminam com sucesso, o CLI publica:

- `videos-soltos/`: originais do Omni;
- `videos-unidos/`: reprodução contínua na ordem do arquivo de jobs;
- `metadados/concat.txt`: ordem exata da montagem;
- `receitas/`: recibo encadeado da montagem local;
- `manifest.json`: perfil, partes, unido e validação;
- `videos-soltos/summary.json`: resultado do batch e estado da pesquisa.

Se qualquer job falhar, a montagem é marcada como `skipped` e os originais
válidos permanecem preservados. O CLI não repete nem substitui o job.

## Contrato recomendado do prompt

O arquivo JSX deve declarar:

1. duração e proporção;
2. estado visual autoral do frame zero, sem exibir a referência;
3. hierarquia visual e tokens;
4. timeline dos estados e movimentos;
5. frase exata da narração, idioma, voz e intervalo;
6. efeitos sonoros com instante e evento visual correspondente;
7. proibições explícitas, como música, legendas ou elementos extras;
8. estado final estável e corte limpo.

Exemplo abreviado:

```jsx
/**
 * OMNI_STUDIO_RENDER_INSTRUCTION
 * Render as one 10-second 16:9 modern React motion video.
 * Brazilian Portuguese narration, exact words only:
 * "A interface responde no momento certo."
 * SFX: soft click at 2.0s bound to toggle-on;
 * confirmation chime at 6.5s bound to status-ready.
 * No music, subtitles, extra speech or automatic fade-out.
 */
const audio = {
  narration: {
    from: 2.2,
    to: 5.8,
    text: "A interface responde no momento certo."
  },
  cues: [
    { at: 2.0, event: "toggle-on", sound: "soft click" },
    { at: 6.5, event: "status-ready", sound: "confirmation chime" }
  ]
};
```

## Validação

A validação automática é técnica e provider-free: prompt e recibo, existência
dos MP4, duração, streams compatíveis, `ffprobe` e decodificação integral do
unido. Pronúncia, aderência visual e sincronismo percebido permanecem avaliação
humana; nunca disparam correção ou regeneração automática.
