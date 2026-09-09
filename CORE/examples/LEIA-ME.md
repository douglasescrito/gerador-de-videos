# Exemplos do motor

- [Plano-sequência](plano-sequencia.example.json): três planos geométricos sem
  pessoa ou marca. O primeiro abre a cena; cada seguinte usa um frame do anterior.
- [Vozes](tts-speakers.example.json): tabela de associação entre papel e nome
  do catálogo Google Vids. Não é uma receita executável nem uma opção `--speakers`
  do comando `tts`. Use cada voz em uma chamada explicitamente planejada ou
  configure os módulos de narração da Receita Mestre.
- [Cena local](local-render-scene.json): entrada neutra para o comando `render`.
- [Componentes Canvas](canvas-motion-components.mjs) e
  [galeria Three.js](three-gallery-authoring.mjs): documentos para o renderer
  existente, sem servidor ou executor adicionais.

Em `CORE`, inspecione a cadeia sem chamar o provedor:

```powershell
npm run chain -- --spec examples/plano-sequencia.example.json --out-dir outputs/meu-estudo/cadeia --dry-run
```

O plano mostra três chamadas previstas, com `text_to_video` na abertura e
`image_to_video` nos elos seguintes. O dry-run não gera frames, vídeo ou recibos.
Para executar, o operador precisa autorizar explicitamente o envio dos frames
derivados com `--confirm-provider-input true`. A técnica de herdar frames é
específica desta receita; não deve entrar silenciosamente em outras produções.
O planejamento correto não garante continuidade visual perfeita do provedor.

Uma cena com `role: brand` é opcional e exige `logo` próprio autorizado. O
exemplo não contém essa cena nem fornece arte de marca. O runner é legado e
sua detecção de saída existente não substitui verificação de integridade e
recibo: confira a mídia antes de retomar. Uma tentativa ambígua exige a
reconciliação canônica, nunca uma segunda submissão por inferência.

Consulte `npm run video -- voices` para o catálogo local e `tts --help` para
os parâmetros de narração. A disponibilidade real depende da conta do operador.
Os exemplos não levam cookies, documentos Vids ou evidências de sessão.
