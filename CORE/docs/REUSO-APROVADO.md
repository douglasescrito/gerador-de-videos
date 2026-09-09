# Reuso aprovado no CLI

O executor pode aproveitar um grafismo `local-gc@1`, uma trilha ajustada por `music-fit`, um master de mixagem `audio-mix` ou um vídeo finalizado por `finish-video` de outra produção. O hit copia o artefato validado, registra sua origem no journal e evita a operação local correspondente antes de reservar CPU. Os demais nós continuam no mesmo executor. Geração remota, montagem e as operações editoriais de fechamento ainda não consultam esse mecanismo.

## Política congelada

A Receita Mestre aceita, nos quatro formatos, o campo opcional:

```json
"reuse": { "policy": "prefer-approved" }
```

`off` é o padrão. `prefer-approved` executa a operação normalmente se não houver contexto ou candidato correspondente e aprovado. `require-approved` exige um hit para cada nó elegível (`motion:*`, `music-fit`, `audio-mix` e `delivery`) e recusa contexto ausente antes de gerar mídia. Ainda pode haver mídia gerada antes de descobrir que seus bytes não correspondem a um candidato: a receita só fica comparável quando existe a entrada material. Direito revogado, negado, desconhecido ou expirado bloqueia; não é tratado como licença para renderizar de novo. Uma produção que exige reuso precisa de candidatos para todos os seus nós elegíveis, inclusive mixagem e acabamento quando presentes. Planos históricos com mixagem embutida em `master` conservam esse caminho; não ganham nós nem reuso silenciosamente.

Em `recipe suggest`, a mesma configuração pode entrar em `modules.reuse`, pelo arquivo de módulos. `plan` e `explain` conservam a política. Alterá-la exige novo plano; `resume` não altera a receita congelada. Receitas anteriores sem esse campo mantêm seus locks de schema.

## Origem e autorização

O contexto de execução continua sendo `mkt-videos/local-asset-context@1`, recebido por `--asset-context`. O bloco opcional `reuse` contém:

- `dbFile`: caminho absoluto do índice editorial já existente.
- `candidates`: até 256 entradas com `receiptFile` absoluto, `asset` governado e `binding`.

O `asset` segue o descritor já usado no reuso local: `id`, `mediaKind`, `role`, `source.kind: knowledge-core`, `source.locator` com o ID do reference-asset, `sha256`, `bytes`, `mimeType`, `rights.reuse: allowed` e `authorization` com `mode: scope-grant` e `bindingHash` igual ao hash do item governado. Os aliases físicos continuam em `context.roots`; o banco privado permanece em `context.dbFile`.

O binding tem este formato; os valores entre colchetes devem ser obtidos do recibo real:

```json
{
  "schema": "mkt-videos/approved-reuse-binding@1",
  "recipeHash": "[hash calculado por recipeFromReceipt]",
  "receiptHash": "[receipt.hash.value]",
  "artifactRole": "motion-master",
  "consumer": {
    "id": "render-motion-graphics",
    "version": "motion-graphics@1.2.0"
  }
}
```

Esse mesmo objeto precisa estar em `attributes.approvedReuse` do reference-asset ativo, coberto pelo hash do item. Acrescentá-lo apenas ao contexto não concede autoridade. `reuse --action prepare` monta a proposta revisável e `reuse --action register` registra a decisão humana no repository canônico de Knowledge. `import-candidate` e `register-asset-link` não substituem esse registro.

## Preparação e registro pelo CLI

O contexto-base precisa apontar para um banco Knowledge já inicializado, um root/scope existente e aliases físicos absolutos. O catálogo de candidatos pode estar vazio. O cadastro de scopes continua em `knowledge --action provision-scopes`; não é criado silenciosamente pelo reuso.

```powershell
node scripts/omni-cli.mjs reuse --action prepare --asset-context C:\privado\assets-base.json --db C:\privado\archive.sqlite --source-receipt C:\midia\grafismo.receipt.json --role motion-master --root-alias outputs --reason "Aprovar este grafismo para reuso local" --out C:\privado\proposta-reuso.json
node scripts/omni-cli.mjs reuse --action register --input C:\privado\proposta-reuso.json --expected-proposal-hash HASH_MOSTRADO_NA_PREPARACAO --confirm-human true --out C:\privado\assets-aprovados.json
```

`prepare` só lê mídia, recibo, scope e revisão editorial. A proposta contém os hashes, os bytes, o papel, o consumidor, o owner e os direitos propostos. Ela possui envelope `knowledge-record-envelope@1`, classificação `restricted` por padrão e autoridade `none`; o documento de proposta não concede reuso. `--classification` e `--scope-id` permitem explicitar os valores antes da revisão. Os documentos privados de entrada e saída ficam fora do workspace, em JSON, sem sobrescrita; inputs com links ou hardlinks e arquivos acima de 1 MiB são recusados.

`register` exige confirmação humana literal e o hash exato da proposta. O efeito aprovado permite inventário, análise e reuso locais do artefato específico. Envio a provider, indexação textual, embedding e treinamento permanecem negados; publicação permanece desconhecida. A decisão não autoriza outra receita, conteúdo ou consumidor.

O reference-asset e seu registro de direitos são escritos juntos por `appendKnowledgeItemsAtomic`. A revisão editorial usa uma comparação transacional contra o estado observado na preparação. O índice recebe somente o recibo selecionado e conserva sua raiz de inventário anterior. O resultado é um novo `asset-context` diretamente utilizável por `copy`, `run` e `resume`.

Knowledge e índice editorial são stores existentes distintos. Se a fase editorial falhar após o registro atômico, o erro informa que o registro foi preservado e a conclusão ficou pendente. A mesma proposta pode ser retomada sem duplicar os itens. Uma revisão editorial concorrente ou revogação posterior bloqueia; repetir a proposta nunca restaura direitos. Uma saída de contexto já existente não é sobrescrita: conserve-a ou forneça outro `--out`.

Além do registro governado, o recibo exato precisa estar aprovado no índice editorial. O runtime compara ID e hash do recibo com a revisão e recalcula a receita. Não pesquisa conteúdo de outros roots para preencher candidatos. O repository emite um ScopeGrant de leitura dedicado ao root da produção e revalida `localAnalysis`, `reuse`, retenção e estado vigente. O binding trava conteúdo sem congelar um direito já revogado.

## Chave, publicação e retomada

A receita de grafismo considera os hashes dos vídeos de entrada, os cards completos, aspecto, preservação de áudio, timeline, BrandKit, contexto semântico aplicável e consumidor versionado. A versão deve ser incrementada quando o contrato do renderer mudar. Caminhos e IDs de tentativa não concedem hit. `motionGraphicsRecipe` e o recibo usam a mesma construção de parâmetros, inclusive o modo Studio.

A trilha ajustada usa o papel `music-bed` e consumidor `music-fit@1.1.0`. `musicFitRecipe` deriva a mesma decisão usada pelo ajuste: hash do áudio de origem, duração da fonte e do alvo, filtro, loops, crossfade, fade explicitamente solicitado e contexto semântico aplicável. Fonte alterada durante a inspeção ou o ajuste bloqueia a conclusão. A consulta ainda executa FFprobe para determinar a duração; essa atividade aparece nas medições de subprocessos locais. Um hit evita o ajuste FFmpeg, não a geração Flow Music da fonte nem a mixagem do master. Os recibos anteriores sem consumidor versionado continuam sem elegibilidade automática.

O acabamento usa o papel `delivery-video` e consumidor `finish-video@1.1.0`. `finishVideoRecipe` compartilha com o recibo a construção de perfil, filtro/LUT, argumentos do encoder, codec de áudio, `faststart`, exigência de integridade e bindings dos arquivos por papel, hash, tamanho e MIME. Trocar entre si os conteúdos de vídeo e LUT não conserva a chave, mesmo que o conjunto de hashes seja igual. CPU/NVENC e perfis distintos não compartilham resultado. A resolução de `auto` continua consultando as capacidades quando necessário; não há promoção automática de encoder. A publicação reaproveitada é reconferida pelo nó antes de finalizar a entrega.

Para preparar a autorização de áudio, o mesmo `reuse --action prepare` recebe o recibo de `music-fit`, `--role music-bed` e o alias que contém o WAV. As etapas `register` e a entrada `--asset-context` são as mesmas do exemplo de grafismo. Não há outro banco, aprovação implícita ou comando de áudio paralelo.

A cópia é preparada em arquivo temporário, conferida contra os bytes aprovados e publicada sem sobrescrita após nova leitura dos direitos, da revisão e do recibo. Um papel ausente nunca cai no primeiro artefato da lista. Divergência ou revogação durante essa preparação remove somente o temporário da tentativa. Os originais são preservados.

O journal registra os hashes do artefato e do recibo reutilizados e marca `reuseSource: approved-archive`. A retomada de trabalho exige os mesmos hashes e autorização atual, mesmo que o arquivo reutilizado já exista. Consultar uma produção já entregue não constitui novo uso ou renovação de direitos. Um recibo refeito para retirar a origem governada é recusado. As etapas locais descendentes conferem novamente a origem antes do uso, após a espera por capacidade e antes de registrar conclusão. Revogação detectada depois de processamento local impede registrar conclusão; arquivos já materializados não são apagados nem tratados como entregues.

## Cópia avulsa e relatórios

```powershell
node scripts/omni-cli.mjs reuse --asset-context assets.json --source-receipt origem.receipt.json --role motion-master --policy require-approved --out grafismo-reutilizado.mp4
```

O `--db` antigo, se fornecido, precisa corresponder ao índice declarado no contexto. A cópia avulsa identifica origem e autorização, mas não afirma ter evitado uma execução. Recibos legados sem consumidor versionado e registro governado não são candidatos autorizados automaticamente.

`jobs` mostra os nós com reuso aprovado. `usage` separa cópias, operações locais evitadas e chamadas de provider: reusar grafismo não aumenta a contagem de POSTs evitados. As medições do nó mostram publicação/verificação; processamento local e espera por CPU permanecem ausentes quando não ocorreram. Esses relatórios são leituras passivas, não uma renovação de direitos.

## Evidência e continuidade

`test/approved-reuse-runtime.test.mjs` executa duas produções completas com vídeo de provider simulado e FFmpeg real. O acabamento da primeira passa pelo serviço canônico de preparação/registro e se junta ao grafismo no mesmo contexto governado. A segunda entrega um master físico com ambos copiados: seis submissões de vídeo simuladas, um render de grafismo e um acabamento. Não há lease dos dois nós reutilizados. A prova cobre hashes, mudança de perfil/integridade, retomada, revogação para descendentes e adulteração de recibo. `test/recipe-reuse.test.mjs` cobre o comando público, root, versão, parâmetros, papel, revisão retirada, bytes divergentes e revogação durante preparação. `test/delivery-profile.test.mjs` cobre LUT, encoder e a troca de conteúdo entre papéis.

`test/approved-reuse-registration.test.mjs` também percorre `prepare → register → copy` pelo comando público, verifica ausência de direitos antes da confirmação e testa retomada, concorrência, revisão retirada e revogação. A preparação e o registro iniciais estão implementados; mudanças posteriores nos direitos continuam dependentes de decisão humana governada.

`test/approved-music-reuse-runtime.test.mjs` entrega dois masters físicos com vídeo e áudio usando providers simulados: seis submissões de vídeo, duas de música, apenas um ajuste de trilha e uma mixagem. O segundo ajuste e a segunda mixagem copiam os WAVs aprovados sem seus leases. A mixagem é preparada/registrada pelo serviço público existente. A prova interrompe a montagem, revoga separadamente os direitos da trilha e do master de áudio e confirma recusa de retomada; novas decisões permitidas na fixture permitem concluir sem repetir efeitos anteriores. Duração/crossfade/ganho diferentes alteram as chaves; originais, hashes, duração final e contagens de operações são conferidos.

O consumidor `mix-audio@1.1.0` usa papel `audio-master`. `audioMixRecipe` e o recibo compartilham parâmetros: ganhos, loudness, ducking, fades, cauda, duração efetiva, cues, filtro, formato PCM e entradas ordenadas por papel/hash/tamanho/MIME. Trocar voz por música não conserva a chave mesmo quando o conjunto de hashes é igual. Entradas são hasheadas antes das sondagens e reconferidas antes do processamento e da publicação. O lookup ainda usa FFprobe para derivar a duração; o reuso evita a mixagem e sua reserva de CPU, sem afirmar ausência de toda inspeção local.

## Preservação literal nos grafismos

`motion-graphics@1.2.0` registra `textEncoding: libass-literal@1`. Chaves são escapadas conforme a [extensão documentada pelo libass](https://github.com/libass/libass/wiki/Libass%27-ASS-Extensions#literal-curly-brackets); barras recebem um WORD JOINER invisível para impedir interpretação de `\N`, `\n` ou `\h`, conforme o comportamento do [parser do libass](https://github.com/libass/libass/blob/master/libass/ass_parse.c). Quebras reais de linha continuam sendo quebras. Os cards originais permanecem intactos no recibo; a camada ASS derivada contém a codificação. Controles não renderizáveis são recusados no compilador e na leitura do plano antes de usar providers.

A versão nova impede reutilizar automaticamente renders da versão que removia chaves. A prova física compara larguras, linhas e máscaras de pixels para demonstrar chaves, barras, quebras e ausência de glifo adicional pelo separador, além de texto com aparência de tag que permanece visível. Isso não substitui QA de legibilidade, fontes/glyphs disponíveis ou composição; não promete OCR ou fidelidade estética universal. O MP4 final tem texto queimado pelo libass; o sidecar ASS usa uma extensão desse renderer e não promete compatibilidade com VSFilter. A entrada de vídeo também é conferida antes de publicar o derivado.

Permanecem no plano unificado: ampliar os consumidores para áudio, blocos e fechamentos; ampliar as provas de invalidação de ambiente do renderer quando esse ambiente fizer parte do contrato de uma receita. Não há autorização implícita para referências privadas, promoção de conhecimento ou reenvio a provider.
