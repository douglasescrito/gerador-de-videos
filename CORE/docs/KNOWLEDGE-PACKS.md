# Knowledge packs audiovisuais

<!-- Gerado por scripts/generate-knowledge-pack-catalog.mjs. Não editar manualmente. -->

Schema da projeção: `mkt-videos/domain-pack-catalog-markdown@1`.
Schema dos packs: `mkt-videos/domain-pack@1`.
Manifest: `e8a41b3bae40bb5d2094fec87dd60dcd396d73398e47e2023ef4adcfa2bc639f`.

Total: 7; aprovados: 0; candidatos: 7.

> Validade estrutural não é aprovação editorial. Packs `candidate` são
> inspecionáveis, mas não podem influenciar retrieval ou planejamento.

| Pack | Lifecycle | Princípios | Fontes | Cobertura | Hash |
|---|---|---:|---:|---:|---|
| `brand-and-channel@2` | `candidate` | 5 | 7 | 15/15 | `d24dc47fb92682b59721ef394222be97c556f28d879e3b6c0a431ab80eb20d3b` |
| `commercial-storytelling@1` | `candidate` | 6 | 6 | 20/20 | `01777061d8cbeb33040f91c5d60f1cb14c711c185181e3e15becda9446f3bb3f` |
| `documentary-practice@1` | `candidate` | 7 | 8 | 21/21 | `03c52cb0e16954372c98691c173ac59cfd54e125b037daff128a146dab7b0401` |
| `hybrid-rendering@2` | `candidate` | 7 | 9 | 16/16 | `53668eb82a77f95f822ad85dda03e44a1856d9633d0d32cd57ecb82ce8d27fa9` |
| `motion-foundations@1` | `candidate` | 8 | 6 | 29/29 | `aa4a68930191bb7b243ce98c80c64f64ecd9e19d0f9cb38cf06169e707c0c73e` |
| `short-film-language@1` | `candidate` | 7 | 3 | 21/21 | `3de5147cfdc8efa1a46bb3315e173b7d6d2e5b80cce48b2fae4f061baefafe77` |
| `sound-and-music@2` | `candidate` | 9 | 8 | 18/18 | `ac7b3d4cde44b6490c12522d7268bf0f788a0e7299e4da46a7558e954ecfbc9d` |

Ordem de carga: `brand-and-channel@2`, `commercial-storytelling@1`, `documentary-practice@1`, `hybrid-rendering@2`, `motion-foundations@1`, `short-film-language@1`, `sound-and-music@2`.

## `brand-and-channel@2` — Marca e canal

- Lifecycle editorial: `candidate`.
- Hash canônico: `d24dc47fb92682b59721ef394222be97c556f28d879e3b6c0a431ab80eb20d3b`.
- Arquivo: `brand-and-channel@2.domain-pack.json`; SHA-256 `cd198af314f904ea4e7c28fceb7fa8d013b307f6c6e25ab2dd4c5ffd5f495389`.
- Resumo: Contrato técnico para preservar identidade e mensagem enquanto formato, duração, safe area, captions e comportamento de consumo variam por canal.
- Domínios: `brand`, `channel`, `delivery`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 15/15 tags declaradas/requeridas.

### Aplicabilidade

- BrandKit, film\-spec, delivery profiles e variantes em modo Studio.
- Uso de logo, tipografia, cor, tom e linguagem governada.
- Adaptação para proporções, durações, interfaces e captions de canais distintos.

### Exclusões

- Criação autônoma de regra de marca ou alteração de logo.
- Cópia de templates, diagramas ou identidade de plataforma.
- Hardcode de especificação volátil como verdade universal.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `brand-kit-contract` | MKT Videos BrandKit contract (`urn:mkt-videos:governance:brand-kit-contract`) | `internal-policy` | MKT Videos | `mkt-videos/brand-kit@1` | `normative-policy` | not\-applicable; acesso `2026-07-24T14:32:31Z`; Contrato interno versionado para palette, typography, logos, requiredTerms, forbiddenTerms, safeAreas, captionStyle e motion. Não autoriza ativos nem promove dados privados. | `d0d4f9bd4329a6da411526300c40b080adf0724e00a25f037c877282178c10dd` |
| `ebu-r95` | [EBU R 95: Safe areas for 16:9 television production](<https://tech.ebu.ch/docs/r/r095.pdf>) | `external-standard` | European Broadcasting Union | não declarada | `factual-extraction-only` | known / EBU\-Terms\-of\-Use; [termos](<https://www.ebu.ch/cms/live/live/en/sites/ebu/terms-of-use.html>); acesso `2026-07-24T14:32:31Z`; Fonte protegida usada apenas para demonstrar que safe area pode ser requisito específico de um perfil broadcast. Valores e diagramas não são reutilizados. | sem snapshot local |
| `google-ads-video-specs` | [Video ad requirements and specifications](<https://support.google.com/google-ads/answer/13547298?hl=en>) | `external-guidance` | Google | não declarada | `citation-only` | known / Google\-Terms\-of\-Service; [termos](<https://policies.google.com/terms?hl=en-US>); acesso `2026-07-24T14:32:31Z`; Fonte proprietária e mutável para formatos de anúncio e interferência de interface. Usada apenas como exemplo de capability datada. | sem snapshot local |
| `studio-governance-brand` | MKT Videos workspace brand governance (`urn:mkt-videos:governance:agents-md`) | `internal-policy` | MKT Videos | `Family distribution workspace policy 2026-09-09` | `normative-policy` | not\-applicable; acesso `2026-09-09T00:00:00Z`; Contrato local que proíbe alteração silenciosa de logo, cor, resolução e acabamento e exige entidades governadas, direitos e recibos. | `ea179bfff41c24e294c8b9fdda2624c3ad5d2ac9ff09000530340f061ee13c42` |
| `tiktok-ad-specs` | [Global App Bundle video ad specifications](<https://ads.tiktok.com/help/article/global-app-bundle-video-ad-specifications>) | `external-guidance` | TikTok for Business | não declarada | `citation-only` | known / TikTok\-Terms\-of\-Service; [termos](<https://www.tiktok.com/legal/page/us/terms-of-service/en>); acesso `2026-07-24T14:32:31Z`; Documentação proprietária e volátil. Nenhum template, diagrama ou valor é copiado; restrições precisam ser confirmadas para região, placement e data. | sem snapshot local |
| `w3c-wcag-22` | [Web Content Accessibility Guidelines 2.2](<https://www.w3.org/TR/WCAG22/>) | `external-standard` | World Wide Web Consortium | `W3C Recommendation` | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Referência para contraste, captions e conteúdo perceptível. Aplicação a MP4 ou canal específico exige perfil próprio e não gera alegação automática de conformidade. | sem snapshot local |
| `youtube-upload-guidance` | [Recommended upload encoding settings](<https://support.google.com/youtube/answer/1722171?hl=en>) | `external-guidance` | Google YouTube | não declarada | `citation-only` | known / Google\-Terms\-of\-Service; [termos](<https://policies.google.com/terms?hl=en-US>); acesso `2026-07-24T14:32:31Z`; Especificação proprietária e volátil. Serve somente para capability revalidada no momento de planejamento e entrega; nenhum valor é universalizado. | sem snapshot local |

### Definições

- **BrandKit** (`def-brand-kit`; base `internal-policy`): Contrato versionado que referencia ativos autorizados e regras verificáveis de identidade, linguagem, safe area, captions e movimento dentro de um escopo governado. Fontes: `brand-kit-contract`, `studio-governance-brand`.
- **Capability de canal** (`def-channel-capability`; base `editorial-synthesis`): Restrição ou possibilidade datada de plataforma, placement, região, dispositivo ou formato que deve ser revalidada antes de compilar e entregar. Fontes: `youtube-upload-guidance`, `google-ads-video-specs`, `tiktok-ad-specs`.
- **Variante de entrega** (`def-delivery-variant`; base `editorial-synthesis`): Derivação rastreável de uma master que adapta forma ou duração para um perfil sem ampliar direitos, alterar alegações ou substituir o original. Fontes: `brand-kit-contract`, `studio-governance-brand`.

### Princípios

#### `p-identity-contract` — Identidade nasce do BrandKit governado

- Base epistemológica: `internal-policy`.
- Modalidade: `hard-constraint`.
- Definição: Logo, tipografia, cor, tom, termos obrigatórios e termos proibidos devem ser resolvidos por versão e escopo de BrandKit, não inferidos de uma referência ou peça anterior.
- Intenção: Separar conhecimento global de regras privadas e mutáveis de cada marca.
- Fontes: `brand-kit-contract`, `studio-governance-brand`.
- Aplicabilidade:
  - Toda peça que representa cliente, marca, produto, projeto ou campanha.
  - Prompt composto, render HTML, montagem e variantes.
- Limites:
  - BrandKit não concede por si só consentimento ou direito sobre asset.
  - Regra ausente deve falhar ou pedir decisão, não ser inventada.
- Riscos:
  - Copiar regra de outro escopo cruza clientes.
  - Inferir tom ou proibição a partir de referência transforma observação em política.
- Sinais de sucesso:
  - Plano congela id, versão e hash do BrandKit.
  - Todo ativo e termo essencial possui origem e owner autorizados.
- Testes:
  - `t-brand-resolution` — cenário: Compilar uma peça com BrandKit ausente, expirado ou de outro root scope. Resultado esperado: Compilação falha fechado ou pede decisão explícita; nenhuma regra é herdada silenciosamente.

#### `p-logo-fidelity` — Logo é asset fiel, não matéria\-prima generativa

- Base epistemológica: `internal-policy`.
- Modalidade: `hard-constraint`.
- Definição: Forma, proporção, construção e variante do logo devem permanecer conforme asset oficial e regras autorizadas; composição pode posicionar ou dimensionar sem deformar.
- Intenção: Preservar reconhecimento, integridade e direito de marca.
- Fontes: `brand-kit-contract`, `studio-governance-brand`.
- Aplicabilidade:
  - Assinatura, end card, watermark, produto e transição com marca.
  - Composição local ou referência enviada a provedor quando autorizada.
- Limites:
  - Animação do logo depende de regra explícita do BrandKit.
  - Redução excessiva pode tornar o asset ilegível mesmo sem deformação.
- Riscos:
  - Geração altera geometria, letras ou relação de cores.
  - Uso da variante errada falha em contraste ou fundo.
- Sinais de sucesso:
  - Arquivo oficial e hash aparecem no plano e recibo.
  - Aspect ratio e geometria do asset permanecem intactos.
- Testes:
  - `t-logo-asset` — cenário: Comparar a origem do logo no plano com o asset oficial e suas transformações autorizadas. Resultado esperado: Existe correspondência exata de asset; transformações preservam proporção e não alteram forma.

#### `p-channel-profile` — Plataforma, aspect ratio, duração e safe area são parâmetros versionados

- Base epistemológica: `source-grounded`.
- Modalidade: `capability`.
- Definição: Cada entrega deve declarar canal, placement, proporção, duração, interface prevista e safe area com data de validade e fonte, evitando constantes globais.
- Intenção: Fazer o layout responder ao destino real e permitir atualização sem reescrever fundamentos.
- Fontes: `ebu-r95`, `youtube-upload-guidance`, `google-ads-video-specs`, `tiktok-ad-specs`.
- Aplicabilidade:
  - Broadcast, feed, stories, shorts, anúncios, landing pages e apresentação.
  - Planejamento de master e variantes.
- Limites:
  - Especificações mudam por região, placement, conta e produto.
  - Safe area técnica não garante boa composição.
- Riscos:
  - Valor desatualizado causa recorte ou rejeição.
  - Uma safe area copiada de outro canal desloca elementos sem necessidade.
- Sinais de sucesso:
  - Capability possui source, accessedAt e escopo.
  - Runtime revalida requisitos críticos antes da entrega.
- Testes:
  - `t-channel-expiry` — cenário: Planejar uma variante com capability expirada ou sem placement. Resultado esperado: O sistema bloqueia ou exige atualização humana, sem aplicar valores presumidos.

#### `p-mobile-captions-access` — Mobile\-first preserva legibilidade, captions e acesso

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Informação essencial deve sobreviver a tela pequena, orientação, interface, reprodução sem som e condições de contraste do destino.
- Intenção: Projetar para o contexto de consumo em vez de apenas reduzir a master.
- Fontes: `w3c-wcag-22`, `google-ads-video-specs`, `tiktok-ad-specs`.
- Aplicabilidade:
  - Feeds, stories, shorts e qualquer visualização em tela pequena.
  - Texto, logo, CTA, disclaimers, captions e gráficos.
- Limites:
  - Mobile\-first não significa vertical obrigatório.
  - WCAG é referência web; conformidade depende do meio e implementação.
- Riscos:
  - Texto reduzido ou interface sobreposta elimina informação.
  - Mensagem que depende de áudio falha em reprodução silenciosa.
- Sinais de sucesso:
  - Texto essencial é legível na escala alvo.
  - Captions e sinais visuais preservam o conteúdo necessário sem áudio.
- Testes:
  - `t-mobile-preview` — cenário: Revisar a variante no tamanho e com as sobreposições aproximadas do dispositivo alvo, com áudio desligado. Resultado esperado: Marca, mensagem, CTA e captions permanecem identificáveis e dentro da área segura declarada.

#### `p-variant-equivalence` — Variantes mudam forma, não autoridade

- Base epistemológica: `internal-policy`.
- Modalidade: `hard-constraint`.
- Definição: Recorte, reflow, duração e captions podem variar, mas identidade, termos, claims, condições, direitos e provenance devem permanecer equivalentes ou ser explicitamente reavaliados.
- Intenção: Evitar que uma adaptação se torne uma peça não governada.
- Fontes: `brand-kit-contract`, `studio-governance-brand`.
- Aplicabilidade:
  - Aspect ratios alternativos, cutdowns, localização e versões com ou sem captions.
  - Entregas derivadas de uma mesma master.
- Limites:
  - Uma duração muito menor pode exigir novo argumento, não mero corte.
  - Localização pode exigir revisão de linguagem e legal.
- Riscos:
  - Cutdown remove qualificador ou contexto.
  - Reflow muda hierarquia de marca e oferta.
- Sinais de sucesso:
  - Cada variante deriva de plano e recibo rastreáveis.
  - Matriz de invariantes é verificada antes da publicação.
- Testes:
  - `t-variant-invariants` — cenário: Comparar master e variantes quanto a logo, termos, claims, condições, direitos e CTA. Resultado esperado: Invariantes permanecem ou a diferença possui aprovação e novo escopo explícitos.


### Exceções

- `x-brandless-editorial` — princípios `p-identity-contract`, `p-logo-fidelity`. Condição: A produção aprovada é deliberadamente sem marca e não representa entidade que exija assinatura. Resposta: Registrar a ausência como decisão do brief; não criar logo, paleta ou assinatura substituta. Fontes: `brand-kit-contract`, `studio-governance-brand`.

### Anti-padrões

- **Tratar crop como variante completa** (`a-crop-is-variant`): Recortar a master para outra proporção sem reflow, safe area, captions, duração, interface ou revisão de invariantes.
  - Princípios: `p-channel-profile`, `p-mobile-captions-access`, `p-variant-equivalence`.
  - Riscos: Logo, texto ou sujeito são cortados.; Qualificadores e CTA perdem contexto..
  - Mitigações: Compilar variante por delivery profile.; Revisar layout e invariantes no dispositivo alvo..
  - Fontes: `google-ads-video-specs`, `tiktok-ad-specs`, `brand-kit-contract`.

### Exemplos abstratos

- **Reflow governado para tela vertical** (`e-governed-reflow`): A variante reposiciona texto e CTA dentro da safe area vigente, mantém o mesmo asset de logo, preserva termos e oferece captions, sem esticar ou recortar a master.
  - Análise: A adaptação responde ao canal, mas identidade e autoridade permanecem ligadas ao BrandKit e à master.
  - Princípios: `p-logo-fidelity`, `p-channel-profile`, `p-mobile-captions-access`, `p-variant-equivalence`.
  - Fontes: `brand-kit-contract`, `tiktok-ad-specs`, `w3c-wcag-22`.

### Contraexemplos

- **Especificação de plataforma congelada como verdade** (`c-platform-constant`): Um valor lido em página de ajuda é copiado para código sem data, placement, região ou revalidação.
  - Análise: A fonte pode estar correta no acesso e ainda ser inadequada para outro escopo ou expirar. O dado pertence ao capability registry, não ao fundamento atemporal.
  - Princípios: `p-channel-profile`.
  - Fontes: `youtube-upload-guidance`, `google-ads-video-specs`, `tiktok-ad-specs`.

### Cobertura governada

- Tags obrigatórias: `identity`, `logo`, `typography`, `color`, `tone`, `required-terms`, `prohibited-terms`, `platform`, `aspect-ratio`, `safe-area`, `duration`, `captions`, `mobile-first`, `accessibility`, `delivery-variants`.
- Mapeamento tag → princípios:
  - `accessibility`: `p-mobile-captions-access`.
  - `aspect-ratio`: `p-channel-profile`, `p-variant-equivalence`.
  - `captions`: `p-mobile-captions-access`.
  - `color`: `p-identity-contract`.
  - `delivery-variants`: `p-variant-equivalence`.
  - `duration`: `p-channel-profile`, `p-variant-equivalence`.
  - `identity`: `p-identity-contract`.
  - `logo`: `p-identity-contract`, `p-logo-fidelity`.
  - `mobile-first`: `p-mobile-captions-access`.
  - `platform`: `p-channel-profile`.
  - `prohibited-terms`: `p-identity-contract`, `p-variant-equivalence`.
  - `required-terms`: `p-identity-contract`, `p-variant-equivalence`.
  - `safe-area`: `p-channel-profile`, `p-mobile-captions-access`.
  - `tone`: `p-identity-contract`.
  - `typography`: `p-identity-contract`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com BrandKit, fidelidade de logo, capability de canal, mobile, captions e variantes.; Especificações de plataforma foram isoladas como dados voláteis e não como constantes globais..
- Versão 2, `2026-09-09`: Nova versão candidata para distribuição familiar: vínculo com a política sanitizada do workspace. Conteúdo técnico e termos preservados; nenhuma ativação ou promoção..

## `commercial-storytelling@1` — Storytelling comercial responsável

- Lifecycle editorial: `candidate`.
- Hash canônico: `01777061d8cbeb33040f91c5d60f1cb14c711c185181e3e15becda9446f3bb3f`.
- Arquivo: `commercial-storytelling@1.domain-pack.json`; SHA-256 `92516b70cc352c903e83fa760b8562368734e3150f788ebfe7350ca3e7917fce`.
- Resumo: Estrutura técnica para ligar objetivo de negócio, audiência, mensagem, prova, oferta e canal sem transformar persuasão em alegação não sustentada.
- Domínios: `commercial`, `advertising`, `storytelling`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 20/20 tags declaradas/requeridas.

### Aplicabilidade

- Briefs, roteiros, film\-spec e revisão de peças comerciais em modo Studio.
- Anúncios, institucionais, demonstrações, lançamentos e comunicação de oferta.
- Adaptação de uma mensagem para canal, duração e comportamento mobile.

### Exclusões

- Aconselhamento jurídico ou aprovação regulatória.
- Invenção de prova, depoimento, certificação, escassez ou resultado.
- Otimização autônoma baseada em performance ou consumo automático de cota.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `brazil-consumer-code` | [Lei nº 8.078, de 11 de setembro de 1990](<https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm>) | `external-law` | Presidência da República do Brasil | não declarada | `factual-extraction-only` | public\-domain / Lei\-9610\-1998\-Art\-8\-IV; [termos](<https://www.planalto.gov.br/ccivil_03/leis/l9610.htm>); acesso `2026-07-24T14:32:31Z`; Ato oficial usado para extração factual dos deveres relativos a identificação, suporte de dados e proibição de publicidade enganosa ou abusiva. O pack não oferece interpretação jurídica. | sem snapshot local |
| `conar-code-2024` | [Código Brasileiro de Autorregulamentação Publicitária](<https://www.conar.org.br/pdf/Codigo-CONAR-2024.pdf>) | `self-regulatory-code` | Conselho Nacional de Autorregulamentação Publicitária | `2024` | `citation-only` | unknown; acesso `2026-07-24T14:32:31Z`; Não foi encontrada licença aberta para o documento. Usado somente como referência normativa brasileira sobre identificação, honestidade, prova, testemunhais, direitos e responsabilidade; sem copiar texto ou estrutura. | sem snapshot local |
| `ftc-dot-com-disclosures` | [Dot Com Disclosures](<https://www.ftc.gov/business-guidance/resources/com-disclosures-how-make-effective-disclosures-digital-advertising>) | `external-guidance` | United States Federal Trade Commission | não declarada | `factual-extraction-only` | known / FTC\-Website\-Policy; [termos](<https://www.ftc.gov/policy-notices/website-policy>); acesso `2026-07-24T14:32:31Z`; Usada para critérios de clareza e proximidade de disclosure em mídia digital; requisitos jurídicos concretos devem ser revistos para a jurisdição e campanha. | sem snapshot local |
| `ftc-native-advertising` | [Native Advertising: A Guide for Businesses](<https://www.ftc.gov/business-guidance/resources/native-advertising-guide-businesses>) | `external-guidance` | United States Federal Trade Commission | não declarada | `factual-extraction-only` | known / FTC\-Website\-Policy; [termos](<https://www.ftc.gov/policy-notices/website-policy>); acesso `2026-07-24T14:32:31Z`; Base para identificação clara de natureza comercial e avaliação da impressão global. O pack não reproduz exemplos ou linguagem regulatória. | sem snapshot local |
| `ftc-substantiation` | [FTC Policy Statement Regarding Advertising Substantiation](<https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation>) | `external-guidance` | United States Federal Trade Commission | não declarada | `factual-extraction-only` | known / FTC\-Website\-Policy; [termos](<https://www.ftc.gov/policy-notices/website-policy>); acesso `2026-07-24T14:32:31Z`; Usada para o princípio factual de possuir base razoável antes de veicular alegações objetivas. Nenhum selo, endosso institucional ou texto extenso é reutilizado. | sem snapshot local |
| `google-ads-video-specs` | [Video ad requirements and specifications](<https://support.google.com/google-ads/answer/13547298?hl=en>) | `external-guidance` | Google | não declarada | `citation-only` | known / Google\-Terms\-of\-Service; [termos](<https://policies.google.com/terms?hl=en-US>); acesso `2026-07-24T14:32:31Z`; Especificações são voláteis e proprietárias. Servem apenas para demonstrar que canal, proporção, duração e áreas de interface devem ser capacidades revalidadas; nenhum valor é incorporado como constante universal. | sem snapshot local |

### Definições

- **Alegação comercial** (`def-claim`; base `source-grounded`): Mensagem expressa ou implícita que o público pode entender como afirmação sobre produto, serviço, preço, benefício, resultado, comparação ou relação comercial. Fontes: `ftc-substantiation`.
- **Razão para acreditar** (`def-reason-to-believe`; base `editorial-synthesis`): Evidência ou mecanismo autorizado que liga a promessa ao benefício; pode ser demonstração verificável, dado aprovado, característica concreta ou prova social com direitos e contexto válidos. Fontes: `ftc-substantiation`, `conar-code-2024`.
- **Impressão global** (`def-net-impression`; base `source-grounded`): Sentido provável produzido pelo conjunto de palavras, imagens, áudio, omissões, ênfases e contexto, e não apenas por uma frase isolada. Fontes: `ftc-native-advertising`.

### Princípios

#### `p-brief-alignment` — Objetivo, funil, audiência e canal formam o contrato do brief

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Uma peça deve declarar objetivo de negócio, estágio de funil, audiência, canal, duração e comportamento esperado antes de escolher sua estrutura narrativa.
- Intenção: Evitar que uma mesma peça tente simultaneamente gerar descoberta, explicar tudo, converter e reter sem prioridade.
- Fontes: `google-ads-video-specs`, `ftc-native-advertising`.
- Aplicabilidade:
  - Toda peça comercial ou institucional com ação esperada.
  - Variantes para feeds, stories, pre\-roll, landing pages e apresentações.
- Limites:
  - Funil é modelo de planejamento, não descrição perfeita do comportamento humano.
  - Duração e comportamento de canal mudam e precisam ser revalidados.
- Riscos:
  - Objetivos concorrentes produzem mensagem difusa.
  - Pressupor audiência sem evidência pode gerar linguagem inadequada.
- Sinais de sucesso:
  - Há um objetivo primário e uma ação observável associada.
  - A linguagem e a densidade cabem na duração e no contexto de consumo.
- Testes:
  - `t-one-primary-objective` — cenário: Ler o brief sem roteiro e pedir a identificação de um objetivo primário, uma audiência e uma ação. Resultado esperado: Os três itens são explícitos e não dependem de inferência estética.

#### `p-hook-tension-promise` — Hook abre uma tensão que a promessa resolve

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: O início deve criar relevância por pergunta, contraste, situação, risco ou desejo; a promessa deve responder a essa tensão com benefício compreensível para a audiência.
- Intenção: Construir atenção com significado, sem clickbait desconectado da entrega.
- Fontes: `ftc-native-advertising`, `conar-code-2024`.
- Aplicabilidade:
  - Descoberta, lançamento, demonstração e resposta direta.
  - Peças curtas em que a relevância precisa aparecer cedo.
- Limites:
  - Nem toda comunicação precisa de conflito dramático.
  - Hook cedo é heurística, não garantia de retenção.
- Riscos:
  - Promessa maior que a prova cria impressão enganosa.
  - Tensão artificial pode explorar medo ou vulnerabilidade.
- Sinais de sucesso:
  - Hook e benefício pertencem à mesma proposição.
  - A resolução entrega o que o início fez esperar.
- Testes:
  - `t-hook-payoff` — cenário: Comparar a expectativa criada nos primeiros eventos com a demonstração e o CTA finais. Resultado esperado: A peça resolve ou qualifica a expectativa sem trocar de promessa no meio.

#### `p-proof-demonstration` — Benefício exige prova proporcional e demonstração honesta

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: A intensidade e precisão da prova devem acompanhar a alegação; demonstrações precisam representar condições relevantes e objeções devem ser respondidas com informação autorizada.
- Intenção: Converter razão para acreditar em evidência compreensível sem fabricar certeza.
- Fontes: `ftc-substantiation`, `brazil-consumer-code`, `conar-code-2024`.
- Aplicabilidade:
  - Alegações objetivas, comparações, resultados, depoimentos e demonstrações.
  - Peças que antecipam objeções de preço, uso, prazo ou adequação.
- Limites:
  - O pack não decide suficiência jurídica ou científica da prova.
  - Evidência de um contexto não pode ser generalizada sem autorização.
- Riscos:
  - Animação ilustrativa pode parecer teste real.
  - Seleção parcial de dados pode alterar a impressão global.
- Sinais de sucesso:
  - Toda alegação verificável aponta para evidência aprovada antes da veiculação.
  - Demonstração, legenda e áudio não ampliam o alcance da prova.
- Testes:
  - `t-claim-evidence-map` — cenário: Listar alegações expressas e implícitas e mapear cada uma a evidência, condição e owner. Resultado esperado: Nenhuma alegação objetiva fica sem base prévia ou qualificação visível.

#### `p-offer-cta-signature` — Oferta, CTA e assinatura encerram o mesmo argumento

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: A oferta define o que é disponibilizado e sob quais condições; o CTA explicita o próximo passo; a assinatura confirma a entidade responsável sem introduzir promessa nova.
- Intenção: Reduzir ambiguidade no momento de ação e manter coerência de marca.
- Fontes: `ftc-dot-com-disclosures`, `conar-code-2024`, `brazil-consumer-code`.
- Aplicabilidade:
  - Conversão, captação, lançamento e comunicação de condição comercial.
  - Peças com preço, prazo, disponibilidade ou elegibilidade.
- Limites:
  - CTA pode ser contemplativo ou informativo em peças sem conversão imediata.
  - Condições exigidas variam por jurisdição, produto e canal.
- Riscos:
  - CTA genérico não informa consequência da ação.
  - Condição essencial distante da oferta altera seu sentido.
- Sinais de sucesso:
  - A ação e sua consequência são compreensíveis.
  - Marca, oferta e destino pertencem à mesma entidade autorizada.
- Testes:
  - `t-offer-action` — cenário: Observar apenas o trecho final e identificar anunciante, oferta, condição essencial e próximo passo. Resultado esperado: Os elementos necessários aparecem com clareza compatível com a duração e o canal.

#### `p-disclosure-and-substantiation` — Persuasão não autoriza ocultar natureza comercial ou incerteza

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Conteúdo publicitário deve ser identificável, disclosures devem ser claros e próximos da alegação relevante, e limitações materiais não podem ser neutralizadas por ritmo, voz ou layout.
- Intenção: Proteger a impressão global contra omissão, ambiguidade e falsa autoridade.
- Fontes: `ftc-native-advertising`, `ftc-dot-com-disclosures`, `brazil-consumer-code`, `conar-code-2024`.
- Aplicabilidade:
  - Publicidade nativa, influenciadores, depoimentos, comparação e conteúdo patrocinado.
  - Toda peça com condição ou limitação capaz de mudar a decisão.
- Limites:
  - A forma adequada do disclosure depende da jurisdição e do meio.
  - Este princípio não substitui revisão jurídica.
- Riscos:
  - Texto pequeno ou breve existe formalmente, mas não comunica.
  - Imagem ou voz pode contradizer a qualificação escrita.
- Sinais de sucesso:
  - A natureza comercial é percebida antes ou junto da mensagem persuasiva.
  - Disclosures permanecem legíveis e audíveis no dispositivo alvo.
- Testes:
  - `t-net-impression` — cenário: Revisar a peça como conjunto, incluindo áudio, imagens, ritmo, omissões e texto legal. Resultado esperado: Nenhum componente cria conclusão materialmente mais ampla que a alegação suportada.

#### `p-channel-language-variants` — Canal e audiência parametrizam linguagem e variantes

- Base epistemológica: `source-grounded`.
- Modalidade: `capability`.
- Definição: Aspecto, duração, densidade, captions, safe area, abertura sonora e CTA devem vir de capability atual e do contexto da audiência, preservando a mesma proposição central.
- Intenção: Adaptar execução sem fragmentar promessa, marca ou prova.
- Fontes: `google-ads-video-specs`, `ftc-dot-com-disclosures`.
- Aplicabilidade:
  - Campanhas com múltiplos canais, aspect ratios ou durações.
  - Audiências com repertório, idioma ou contexto de consumo diferentes.
- Limites:
  - Especificações de plataforma expiram e precisam ser revalidadas no planejamento e na entrega.
  - Localização não autoriza alterar alegação ou condição.
- Riscos:
  - Cortar a master pode remover contexto, prova ou disclosure.
  - Tom juvenil, técnico ou coloquial presumido pode desrespeitar a audiência.
- Sinais de sucesso:
  - Cada variante declara capability e audiência válidas.
  - Promessa, evidência, condição e marca permanecem equivalentes entre variantes.
- Testes:
  - `t-variant-equivalence` — cenário: Comparar matriz de mensagem e restrições entre todas as variantes planejadas. Resultado esperado: Mudanças de forma não alteram alegações, identidade, condições ou ação essencial.


### Exceções

- `x-awareness-without-cta` — princípios `p-offer-cta-signature`. Condição: O objetivo aprovado é lembrança ou posicionamento e não existe ação imediata útil. Resposta: Permitir assinatura sem CTA transacional, registrando o objetivo e evitando uma ação artificial. Fontes: `ftc-native-advertising`, `conar-code-2024`.

### Anti-padrões

- **Decoração com aparência de prova** (`a-proof-shaped-decoration`): Usar gráficos, jalecos, selos, números, depoimentos ou cenas de demonstração que parecem evidência sem origem, direitos ou condições verificáveis.
  - Princípios: `p-proof-demonstration`, `p-disclosure-and-substantiation`.
  - Riscos: Alegação implícita não sustentada.; Falsa autoridade e impressão global enganosa..
  - Mitigações: Mapear cada elemento de prova a evidência e owner autorizados.; Rotular ilustração e remover símbolos que ampliem a alegação..
  - Fontes: `ftc-substantiation`, `brazil-consumer-code`, `conar-code-2024`.

### Exemplos abstratos

- **Demonstração com alcance delimitado** (`e-demonstration-with-boundary`): A peça abre com um problema concreto, mostra uma função em condição declarada, apresenta benefício compatível e encerra com oferta e CTA sem prometer resultado além do demonstrado.
  - Análise: A narrativa reduz objeção por demonstração, mas mantém a fronteira entre caso exibido e resultado geral.
  - Princípios: `p-hook-tension-promise`, `p-proof-demonstration`, `p-offer-cta-signature`.
  - Fontes: `ftc-substantiation`, `brazil-consumer-code`.

### Contraexemplos

- **Disclaimer tentando resgatar promessa excessiva** (`c-disclaimer-rescue`): Imagem e voz prometem resultado certo, enquanto uma linha breve e pequena introduz condições que contradizem a mensagem dominante.
  - Análise: A existência formal do texto não corrige a impressão global criada pelos elementos mais salientes.
  - Princípios: `p-proof-demonstration`, `p-disclosure-and-substantiation`.
  - Fontes: `ftc-dot-com-disclosures`, `ftc-native-advertising`, `brazil-consumer-code`.

### Cobertura governada

- Tags obrigatórias: `business-objective`, `funnel-stage`, `audience`, `tension`, `promise`, `benefit`, `proof`, `reason-to-believe`, `objection`, `hook`, `demonstration`, `offer`, `signature`, `call-to-action`, `brand`, `channel`, `duration`, `mobile-behavior`, `audience-language`, `substantiated-claims`.
- Mapeamento tag → princípios:
  - `audience`: `p-brief-alignment`, `p-channel-language-variants`.
  - `audience-language`: `p-channel-language-variants`.
  - `benefit`: `p-hook-tension-promise`.
  - `brand`: `p-offer-cta-signature`, `p-channel-language-variants`.
  - `business-objective`: `p-brief-alignment`.
  - `call-to-action`: `p-offer-cta-signature`.
  - `channel`: `p-brief-alignment`, `p-channel-language-variants`.
  - `demonstration`: `p-proof-demonstration`.
  - `duration`: `p-brief-alignment`, `p-channel-language-variants`.
  - `funnel-stage`: `p-brief-alignment`.
  - `hook`: `p-hook-tension-promise`.
  - `mobile-behavior`: `p-channel-language-variants`.
  - `objection`: `p-proof-demonstration`.
  - `offer`: `p-offer-cta-signature`.
  - `promise`: `p-hook-tension-promise`, `p-proof-demonstration`.
  - `proof`: `p-proof-demonstration`.
  - `reason-to-believe`: `p-proof-demonstration`.
  - `signature`: `p-offer-cta-signature`.
  - `substantiated-claims`: `p-proof-demonstration`, `p-disclosure-and-substantiation`.
  - `tension`: `p-hook-tension-promise`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com jornada comercial, prova, disclosures e adaptação por canal.; Regras jurídicas são tratadas como referências jurisdicionais e não como aconselhamento..

## `documentary-practice@1` — Prática documental responsável

- Lifecycle editorial: `candidate`.
- Hash canônico: `03c52cb0e16954372c98691c173ac59cfd54e125b037daff128a146dab7b0401`.
- Arquivo: `documentary-practice@1.domain-pack.json`; SHA-256 `a6a53492b4f86b5bb93e097732646b430aa8bdac8224e8313d978cca2183300e`.
- Resumo: Fundamentos para estruturar ponto de vista, fontes, evidência, consentimento, arquivo, reconstrução e material gerado sem apresentar interpretação ou dramatização como fato.
- Domínios: `documentary`, `nonfiction`, `editorial-ethics`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 21/21 tags declaradas/requeridas.

### Aplicabilidade

- Documentários, perfis, entrevistas, relatos, vídeos institucionais factuais e reconstruções.
- Planejamento e revisão de claims, fontes, arquivo, B\-roll e disclosure em modo Studio.
- Uso responsável de material gerado em contexto de não ficção.

### Exclusões

- Verificação automática da verdade ou substituição de apuração humana.
- Aconselhamento jurídico sobre privacidade, difamação, direitos autorais ou proteção de fonte.
- Uso de referência, imagem ou depoimento sem direito, consentimento e finalidade válidos.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `brazil-lgpd` | [Lei nº 13.709, de 14 de agosto de 2018](<https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm>) | `external-law` | Presidência da República do Brasil | não declarada | `factual-extraction-only` | public\-domain / Lei\-9610\-1998\-Art\-8\-IV; [termos](<https://www.planalto.gov.br/ccivil_03/leis/l9610.htm>); acesso `2026-07-24T14:32:31Z`; Ato oficial usado para conceitos jurídicos brasileiros de consentimento, finalidade, revogação e anonimização. Não é apresentado como regra universal nem aconselhamento. | sem snapshot local |
| `c2pa-spec-24` | [C2PA Technical Specification 2.4](<https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html>) | `external-standard` | Coalition for Content Provenance and Authenticity | `2.4` | `paraphrase-only` | known / CC\-BY\-4.0; [termos](<https://creativecommons.org/licenses/by/4.0/>); acesso `2026-07-24T14:32:31Z`; Base para conceitos de provenance, ingredientes, ações e material derivado. A síntese atribui a fonte e não reproduz exemplos ou especificação. | sem snapshot local |
| `nichols-documentary-2024` | [Introduction to Documentary, Fourth Edition](<https://iupress.org/9780253070159/introduction-to-documentary-fourth-edition/>) | `bibliography` | Indiana University Press | `Fourth edition` / `2024-08-06` | `citation-only` | unknown; acesso `2026-07-24T14:32:31Z`; Referência bibliográfica para modos e voz documental. Nenhum trecho, estrutura, imagem ou exemplo do livro é copiado; os modos são tratados como estratégias analíticas, não fórmulas. | sem snapshot local |
| `nist-ai-600-1` | [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile](<https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf>) | `external-guidance` | National Institute of Standards and Technology | `NIST AI 600-1` / `2024-07-26` | `factual-extraction-only` | public\-domain / US\-Public\-Domain; [termos](<https://www.nist.gov/copyrights-disclaimers>); acesso `2026-07-24T14:32:31Z`; Publicação governamental usada para riscos de conteúdo sintético e provenance. Atribuição é mantida; material de terceiros eventualmente marcado no documento não é reutilizado. | sem snapshot local |
| `ofcom-section-eight` | [Broadcasting Code: Section Eight, Privacy](<https://www.ofcom.org.uk/tv-radio-and-on-demand/broadcast-standards/section-eight-privacy>) | `external-regulation` | Office of Communications | não declarada | `paraphrase-only` | known / Ofcom\-Terms\-of\-Use; [termos](<https://www.ofcom.org.uk/about-ofcom/our-website/terms-of-use>); acesso `2026-07-24T14:32:31Z`; Referência jurisdicional para expectativa de privacidade, vulnerabilidade e proporcionalidade; não substitui análise jurídica local. | sem snapshot local |
| `ofcom-section-five` | [Broadcasting Code: Section Five, Due Impartiality and Due Accuracy](<https://www.ofcom.org.uk/tv-radio-and-on-demand/broadcast-standards/section-five-due-impartiality-accuracy>) | `external-regulation` | Office of Communications | não declarada | `paraphrase-only` | known / Ofcom\-Terms\-of\-Use; [termos](<https://www.ofcom.org.uk/about-ofcom/our-website/terms-of-use>); acesso `2026-07-24T14:32:31Z`; Fonte regulatória do Reino Unido, usada com atribuição para princípios de exatidão e contexto. Não é universalizada para outras jurisdições. | sem snapshot local |
| `ofcom-section-seven` | [Broadcasting Code: Section Seven, Fairness](<https://www.ofcom.org.uk/tv-radio-and-on-demand/broadcast-standards/section-seven-fairness>) | `external-regulation` | Office of Communications | não declarada | `paraphrase-only` | known / Ofcom\-Terms\-of\-Use; [termos](<https://www.ofcom.org.uk/about-ofcom/our-website/terms-of-use>); acesso `2026-07-24T14:32:31Z`; Usada para informed consent, tratamento justo de contribuições, anonimato e reutilização contextual. Aplicação concreta depende de jurisdição e revisão editorial. | sem snapshot local |
| `witness-ethical-guidelines` | [Video as Evidence: Ethical Guidelines](<https://library.witness.org/product/video-as-evidence-ethical-guidelines/>) | `external-guidance` | WITNESS | não declarada | `citation-only` | known / CC\-BY\-NC\-4.0; [termos](<https://library.witness.org/faq/>); acesso `2026-07-24T14:32:31Z`; A biblioteca declara licença não comercial. Como este projeto pode servir a trabalho comercial, a fonte é somente bibliográfica: nenhum texto, estrutura, caso ou recurso é adaptado ou incorporado. | sem snapshot local |

### Definições

- **Modo documental** (`def-documentary-mode`; base `source-grounded`): Estratégia dominante de relação entre realizador, sujeito, evidência e audiência; modos podem coexistir e não determinam por si só veracidade, ética ou qualidade. Fontes: `nichols-documentary-2024`.
- **Reconstrução** (`def-reconstruction`; base `editorial-synthesis`): Representação criada depois do evento para ilustrar uma hipótese, memória ou sequência que não foi registrada diretamente, devendo ser distinguida de evidência contemporânea ao fato. Fontes: `c2pa-spec-24`, `nist-ai-600-1`, `ofcom-section-five`.
- **Continuidade factual** (`def-factual-continuity`; base `editorial-synthesis`): Consistência entre afirmações, datas, lugares, identidades, relações causais e nível de certeza ao longo da obra e de suas versões. Fontes: `ofcom-section-five`, `c2pa-spec-24`.

### Princípios

#### `p-declared-mode` — Modo é estratégia declarada, não selo de verdade

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Abordagens observacional, expositiva, participativa, poética, reflexiva e performativa organizam presença, voz, experiência situada e forma; uma obra pode combiná\-las desde que a relação com o público não seja mascarada.
- Intenção: Tornar explícito como a obra seleciona, argumenta, participa ou expõe seu próprio processo.
- Fontes: `nichols-documentary-2024`, `ofcom-section-five`.
- Aplicabilidade:
  - Concepção de documentário, perfil, ensaio factual ou entrevista editada.
  - Revisão de voz, presença do realizador e relação entre forma e evidência.
  - Análise de obras em que experiência corporificada ou subjetividade assumida organiza o argumento.
- Limites:
  - Categorias se sobrepõem e não esgotam práticas documentais.
  - Modo não prova exatidão, imparcialidade ou consentimento.
- Riscos:
  - Chamar encenação de observação pode ocultar intervenção.
  - Forma poética pode reduzir a percepção de incerteza factual.
  - Experiência situada pode ser apresentada como evidência geral sem qualificação.
- Sinais de sucesso:
  - A equipe consegue descrever a relação entre câmera, sujeito e argumento.
  - Misturas de modo são reconhecíveis e não criam falsa espontaneidade.
- Testes:
  - `t-mode-accountability` — cenário: Selecionar três sequências e descrever quem observa, quem fala, quem intervém e como a construção aparece. Resultado esperado: A descrição é compatível com o material e não atribui neutralidade automática ao método.

#### `p-claim-source-evidence` — Claim, fonte, evidência e certeza permanecem ligados

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Toda afirmação factual relevante deve apontar para fonte identificada, evidência disponível, método de obtenção e grau de certeza; divergência ou ausência não pode ser escondida por narração assertiva.
- Intenção: Preservar a diferença entre o que é conhecido, inferido, contestado e desconhecido.
- Fontes: `ofcom-section-five`, `witness-ethical-guidelines`, `nist-ai-600-1`.
- Aplicabilidade:
  - Roteiro, cartelas, narração, gráficos, legendas e entrevista.
  - Claims históricos, científicos, biográficos e institucionais.
- Limites:
  - O sistema registra suporte, mas não decide verdade sozinho.
  - Fontes podem compartilhar o mesmo erro ou conflito de interesse.
- Riscos:
  - Certeza verbal maior que a evidência.
  - Fonte secundária apresentada como testemunho direto.
- Sinais de sucesso:
  - Cada claim relevante possui sourceIds e nível de certeza revisáveis.
  - Conflitos e lacunas aparecem na pauta ou na obra quando materiais.
- Testes:
  - `t-claim-ledger` — cenário: Extrair claims do corte e reconciliá\-los com o ledger de fontes e evidências. Resultado esperado: Todo claim material está suportado, qualificado, contestado ou removido por decisão humana registrada.

#### `p-interview-consent-sensitivity` — Entrevista exige consentimento informado e avaliação contínua de risco

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Participantes devem compreender natureza, finalidade, uso provável, mudanças materiais e riscos; vulnerabilidade, anonimização e revogação aplicável devem ser tratadas antes da captura e novamente antes da publicação.
- Intenção: Evitar que uma autorização formal substitua compreensão, proporcionalidade e cuidado.
- Fontes: `ofcom-section-seven`, `ofcom-section-eight`, `witness-ethical-guidelines`, `brazil-lgpd`.
- Aplicabilidade:
  - Entrevistas, testemunhos, imagens de pessoas identificáveis e dados pessoais.
  - Sujeitos vulneráveis, temas sensíveis, anonimato ou risco de retaliação.
- Limites:
  - Bases legais e possibilidade de revogação variam por jurisdição e contexto.
  - Anonimização visual isolada pode falhar por voz, local, metadados ou narrativa.
- Riscos:
  - Recontextualização pode criar dano não previsto na captura.
  - Promessa de anonimato pode ser tecnicamente insuficiente.
- Sinais de sucesso:
  - Consentimento, finalidade, limites e owner estão documentados.
  - Revisão pré\-publicação considera novamente exposição e contexto.
- Testes:
  - `t-reidentification-review` — cenário: Revisar todos os sinais visuais, sonoros, textuais e contextuais de um participante anonimizado. Resultado esperado: Nenhum sinal material de reidentificação permanece sem decisão explícita de risco e autorização adequada.

#### `p-contextual-footage` — B\-roll e arquivo devem manter origem, data, direito e função

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Material de cobertura ou arquivo não é preenchimento neutro: sua seleção pode afirmar presença, causalidade, frequência ou identidade e deve ser governada como evidência ou ilustração.
- Intenção: Impedir que imagens plausíveis alterem o sentido factual da narração.
- Fontes: `ofcom-section-five`, `ofcom-section-seven`, `c2pa-spec-24`.
- Aplicabilidade:
  - B\-roll, fotografias, gravações históricas, stock e material de terceiros.
  - Reutilização de contribuição em contexto diferente.
- Limites:
  - Metadados de origem podem estar incompletos e exigem qualificação.
  - Direito de uso não prova pertinência factual.
- Riscos:
  - Imagem genérica apresentada como local ou evento específico.
  - Arquivo recortado remove condição ou contraditório relevante.
- Sinais de sucesso:
  - Cada asset possui proveniência, direito, data e função editorial declarados.
  - O corte não sugere relação factual além da evidência disponível.
- Testes:
  - `t-footage-context` — cenário: Assistir à sequência sem conhecer a origem dos assets e registrar as inferências prováveis. Resultado esperado: Inferências materiais coincidem com origem e contexto ou são corrigidas por disclosure claro.

#### `p-reconstruction-disclosure` — Reconstrução e imagem gerada são identificadas no ponto de interpretação

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Quando material criado representa pessoa, lugar ou evento factual sem registro direto, sua natureza ilustrativa, reconstruída ou gerada deve ser percebida antes que seja tomada como evidência.
- Intenção: Permitir recurso visual sem converter plausibilidade em documento histórico.
- Fontes: `c2pa-spec-24`, `nist-ai-600-1`, `ofcom-section-five`.
- Aplicabilidade:
  - Imagem ou vídeo gerado, reenactment, simulação, composição e voz sintética.
  - Representação de fato não capturado ou de cenário hipotético.
- Limites:
  - Provenance técnica não prova veracidade nem substitui disclosure perceptível.
  - Rótulo genérico pode ser insuficiente se o trecho mistura arquivo e geração.
- Riscos:
  - Realismo visual produz falsa memória do evento.
  - Disclosure apenas no crédito final chega tarde demais.
- Sinais de sucesso:
  - A audiência consegue distinguir registro, reconstrução e hipótese no momento relevante.
  - Recibo e provenance identificam ingredientes e ações sem expor segredos.
- Testes:
  - `t-generated-material-boundary` — cenário: Revisar todos os trechos sintéticos junto ao contexto que os apresenta. Resultado esperado: Cada trecho possui rótulo perceptível, provenance governada e linguagem que não amplia o grau de certeza.

#### `p-point-of-view-separation` — Fato, interpretação e dramatização ocupam camadas distintas

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Ponto de vista é inevitável, mas deve ser distinguido de afirmação factual; interpretação explicita raciocínio e dramatização explicita construção.
- Intenção: Assumir voz e escolha editorial sem fingir neutralidade nem apagar evidência.
- Fontes: `nichols-documentary-2024`, `ofcom-section-five`, `witness-ethical-guidelines`.
- Aplicabilidade:
  - Narração, ensaio, montagem associativa, entrevistas e reconstruções.
  - Obras autorais ou de advocacy que apresentam tese explícita.
- Limites:
  - Separação pode ser construída por contexto, não apenas por cartela.
  - Declarar opinião não autoriza erro factual evitável.
- Riscos:
  - Montagem sugere causalidade que as fontes não sustentam.
  - Tom de autoridade oculta interpretação contestável.
- Sinais de sucesso:
  - Claims podem ser classificados como fato, interpretação ou dramatização.
  - O ponto de vista está presente sem alterar materialmente falas ou contexto.
- Testes:
  - `t-layer-classification` — cenário: Classificar frases e sequências\-chave em fato, interpretação, dramatização ou combinação. Resultado esperado: Combinações são qualificadas e nenhuma dramatização aparece como registro direto.

#### `p-factual-continuity` — Continuidade factual atravessa roteiro, corte e variantes

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Datas, lugares, identidades, sequências, relações causais e qualificadores devem permanecer consistentes quando a obra é montada, encurtada, legendada ou adaptada.
- Intenção: Impedir que economia narrativa ou variante de canal mude o que a obra afirma.
- Fontes: `ofcom-section-five`, `ofcom-section-seven`, `c2pa-spec-24`.
- Aplicabilidade:
  - Montagem, atualização, tradução, trailer, teaser e versões curtas.
  - Narrativas com cronologia, causalidade ou identidades complexas.
- Limites:
  - Ordem dramática pode diferir da cronológica se isso for claro.
  - Novas evidências podem exigir versão e correção, não reescrita silenciosa.
- Riscos:
  - Corte de qualificador transforma hipótese em fato.
  - Reordenação de fala altera causa, intenção ou resposta.
- Sinais de sucesso:
  - Ledger de claims permanece reconciliado com cada versão.
  - Mudanças factuais têm changelog e fonte.
- Testes:
  - `t-version-claim-diff` — cenário: Comparar claims, qualificadores e contexto entre master e variante curta. Resultado esperado: A variante preserva sentido factual ou registra explicitamente o que não pode representar.


### Exceções

- `x-public-interest-limited-disclosure` — princípios `p-interview-consent-sensitivity`, `p-point-of-view-separation`. Condição: Existe interesse público documentado e obtenção de consentimento ou disclosure integral poderia criar risco material ou inviabilizar apuração legítima. Resposta: Interromper automação, exigir decisão editorial e jurídica humana, aplicar minimização e registrar fundamento, alternativas e riscos sem publicar automaticamente. Fontes: `ofcom-section-seven`, `ofcom-section-eight`.

### Anti-padrões

- **Plausibilidade tratada como evidência** (`a-plausibility-as-evidence`): Usar stock, geração, reenactment ou montagem emocionalmente coerente para preencher lacuna factual sem disclosure e qualificação.
  - Princípios: `p-claim-source-evidence`, `p-contextual-footage`, `p-reconstruction-disclosure`, `p-point-of-view-separation`.
  - Riscos: Falsa memória e causalidade aparente.; Dano a participantes e perda de confiança..
  - Mitigações: Manter lacuna visível e registrar grau de certeza.; Rotular ilustração ou reconstrução no ponto de interpretação..
  - Fontes: `c2pa-spec-24`, `nist-ai-600-1`, `ofcom-section-five`.

### Exemplos abstratos

- **Reconstrução qualificada** (`e-qualified-reconstruction`): A narração informa o que é comprovado e o que é hipótese; a imagem reconstruída recebe rótulo durante o trecho e o ledger preserva fonte, direitos, ingredientes e decisão editorial.
  - Análise: A reconstrução oferece contexto visual sem adquirir o estatuto do registro ausente. Provenance ajuda a auditar origem, mas o disclosure comunica a diferença ao público.
  - Princípios: `p-claim-source-evidence`, `p-reconstruction-disclosure`, `p-point-of-view-separation`.
  - Fontes: `c2pa-spec-24`, `nist-ai-600-1`, `ofcom-section-five`.

### Contraexemplos

- **Anonimização apenas do rosto** (`c-anonymous-face-only`): O rosto é ocultado, mas voz, uniforme, local, horário e detalhes da história permitem reconhecer a pessoa.
  - Análise: Anonimização é resultado contextual, não um efeito visual isolado. O conjunto ainda carrega identificadores e risco previsível.
  - Princípios: `p-interview-consent-sensitivity`.
  - Fontes: `brazil-lgpd`, `ofcom-section-eight`, `witness-ethical-guidelines`.

### Cobertura governada

- Tags obrigatórias: `observational-mode`, `expository-mode`, `participatory-mode`, `poetic-mode`, `reflexive-mode`, `performative-mode`, `claims`, `sources`, `evidence`, `certainty`, `interview`, `b-roll`, `archive`, `reconstruction`, `point-of-view`, `factual-continuity`, `consent`, `anonymization`, `sensitivity`, `generated-image-disclosure`, `fact-interpretation-dramatization`.
- Mapeamento tag → princípios:
  - `anonymization`: `p-interview-consent-sensitivity`.
  - `archive`: `p-contextual-footage`.
  - `b-roll`: `p-contextual-footage`.
  - `certainty`: `p-claim-source-evidence`.
  - `claims`: `p-claim-source-evidence`, `p-point-of-view-separation`.
  - `consent`: `p-interview-consent-sensitivity`.
  - `evidence`: `p-claim-source-evidence`, `p-contextual-footage`.
  - `expository-mode`: `p-declared-mode`.
  - `fact-interpretation-dramatization`: `p-point-of-view-separation`, `p-reconstruction-disclosure`.
  - `factual-continuity`: `p-factual-continuity`.
  - `generated-image-disclosure`: `p-reconstruction-disclosure`.
  - `interview`: `p-interview-consent-sensitivity`.
  - `observational-mode`: `p-declared-mode`.
  - `participatory-mode`: `p-declared-mode`.
  - `performative-mode`: `p-declared-mode`.
  - `poetic-mode`: `p-declared-mode`.
  - `point-of-view`: `p-declared-mode`, `p-point-of-view-separation`.
  - `reconstruction`: `p-reconstruction-disclosure`.
  - `reflexive-mode`: `p-declared-mode`.
  - `sensitivity`: `p-interview-consent-sensitivity`.
  - `sources`: `p-claim-source-evidence`, `p-contextual-footage`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com modos documentais, ledger de claims, consentimento, arquivo, reconstrução e disclosure de material gerado.; Fontes jurisdicionais e bibliográficas foram delimitadas; provenance não é tratada como prova de verdade..

## `hybrid-rendering@2` — Renderização híbrida

- Lifecycle editorial: `candidate`.
- Hash canônico: `53668eb82a77f95f822ad85dda03e44a1856d9633d0d32cd57ecb82ce8d27fa9`.
- Arquivo: `hybrid-rendering@2.domain-pack.json`; SHA-256 `70a0c369e78cace40be33389f6759ed181694973a05d8c0c6843de4e316cdaf2`.
- Resumo: Fundamentos para escolher geração, render determinístico ou combinação, preservando alpha, tipografia exata, timeline, cor, assets, ambiente, licenças e provenance.
- Domínios: `hybrid-rendering`, `html-motion`, `compositing`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 16/16 tags declaradas/requeridas.

### Aplicabilidade

- Planejamento e execução Studio que combinam Omni, HTML, Canvas, mídia local e ferramentas de pós.
- Tipografia exata, UI, data visualization, alpha, composição, frame rate e color management.
- Builds locais determinísticos, provider\-free, e receipts de composição.

### Exclusões

- Renderer HTML ou composição no modo raw.
- Rede, cookies, segredos, downloads implícitos ou filesystem não declarado durante render.
- Fallback silencioso, retry automático ou mudança de renderer sem nova aprovação.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `c2pa-spec-24` | [C2PA Technical Specification 2.4](<https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html>) | `external-standard` | Coalition for Content Provenance and Authenticity | `2.4` | `paraphrase-only` | known / CC\-BY\-4.0; [termos](<https://creativecommons.org/licenses/by/4.0/>); acesso `2026-07-24T14:32:31Z`; Base para ingredients, actions, derivation, composition and validation. Provenance é tratada como história de origem e integridade, não prova de verdade. | sem snapshot local |
| `ffmpeg-filters` | [FFmpeg Filters Documentation](<https://ffmpeg.org/ffmpeg-filters.html>) | `external-guidance` | FFmpeg Project | não declarada | `citation-only` | unknown; [termos](<https://ffmpeg.org/legal.html>); acesso `2026-07-24T14:32:31Z`; A licença do software e a permissão de reutilizar documentação não são presumidas equivalentes. Fonte usada somente para apontar capabilities de composição, alpha, frame rate e cor; sem copiar comandos ou texto. | sem snapshot local |
| `otio-docs` | [OpenTimelineIO Documentation](<https://opentimelineio.readthedocs.io/en/latest/index.html>) | `external-guidance` | Academy Software Foundation | `Documentation current at access date` | `paraphrase-only` | known / Apache\-2.0; [termos](<https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/LICENSE.txt>); acesso `2026-07-24T14:32:31Z`; Base para timeline editorial, clips, tracks, transitions, markers e mídia referenciada externamente; nenhuma implementação é copiada. | sem snapshot local |
| `playwright-browsers` | [Playwright browsers](<https://playwright.dev/docs/browsers>) | `external-guidance` | Microsoft | não declarada | `paraphrase-only` | known / Apache\-2.0; [termos](<https://github.com/microsoft/playwright/blob/main/LICENSE>); acesso `2026-07-24T14:32:31Z`; Base para pinning da versão do browser e seus binários. Nenhum código ou comando de exemplo é copiado. | sem snapshot local |
| `playwright-network` | [Playwright network](<https://playwright.dev/docs/network>) | `external-guidance` | Microsoft | não declarada | `paraphrase-only` | known / Apache\-2.0; [termos](<https://github.com/microsoft/playwright/blob/main/LICENSE>); acesso `2026-07-24T14:32:31Z`; Usada para capacidade de interceptar, bloquear ou simular tráfego no ambiente de render. Nenhum snippet é reutilizado. | sem snapshot local |
| `studio-governance-hybrid` | MKT Videos workspace hybrid rendering governance (`urn:mkt-videos:governance:agents-md`) | `internal-policy` | MKT Videos | `Family distribution workspace policy 2026-09-09` | `normative-policy` | not\-applicable; acesso `2026-09-09T00:00:00Z`; Contrato local para Studio\-only, ambiente pinado, rede e filesystem bloqueados, runtime guard, recibos, raw incompatível com render HTML e ausência de fallback silencioso. | `ea179bfff41c24e294c8b9fdda2624c3ad5d2ac9ff09000530340f061ee13c42` |
| `w3c-compositing-1` | [Compositing and Blending Level 1](<https://www.w3.org/TR/compositing-1/>) | `external-draft-specification` | World Wide Web Consortium | não declarada | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Base factual para ordem de composição, alpha, isolamento e blend. Nenhum algoritmo, tabela ou texto normativo é reproduzido. | sem snapshot local |
| `w3c-css-color-4` | [CSS Color Module Level 4](<https://www.w3.org/TR/css-color-4/>) | `external-draft-specification` | World Wide Web Consortium | não declarada | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Usada para distinguir espaços, conversões e representação de cor no renderer web. Status e implementação devem ser pinados; valores de marca vêm do BrandKit. | sem snapshot local |
| `w3c-css-font-loading-3` | [CSS Font Loading Module Level 3](<https://www.w3.org/TR/2023/WD-css-font-loading-3-20230406/>) | `external-draft-specification` | World Wide Web Consortium | `Working Draft 6 April 2023` / `2023-04-06` | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Especificação em evolução usada para carregamento e estado de fontes. O pack não assume disponibilidade ou licença de uma fonte específica. | sem snapshot local |

### Definições

- **Render determinístico** (`def-deterministic-render`; base `editorial-synthesis`): Render cuja saída pode ser reproduzida bit a bit ou por equivalência declarada a partir de inputs, código, dependências, ambiente e parâmetros pinados, sem dependência externa não registrada. Fontes: `studio-governance-hybrid`, `playwright-browsers`.
- **Composição híbrida** (`def-hybrid-composition`; base `editorial-synthesis`): Timeline que combina artefatos de origem gerativa e determinística em etapas separadas, preservando originais, transformações, direitos e receipts. Fontes: `studio-governance-hybrid`, `w3c-compositing-1`, `c2pa-spec-24`.
- **Alpha** (`def-alpha`; base `source-grounded`): Informação de cobertura ou transparência usada para combinar uma camada com o resultado acumulado; seu significado depende de representação, premultiplicação e pipeline. Fontes: `w3c-compositing-1`.

### Princípios

#### `p-renderer-routing` — A natureza do requisito escolhe o renderer

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Geração atende material orgânico ou aberto à variação; render determinístico atende texto, logo, UI, dados e geometria exatos; composição híbrida combina os dois quando as fronteiras são explícitas.
- Intenção: Evitar pedir precisão impossível ao gerador ou sacrificar expressividade onde variação é aceitável.
- Fontes: nenhum.
- Aplicabilidade:
  - Compilação de film\-spec e seleção de adapter por shot ou camada.
  - Peças com background gerado e overlays exatos.
- Limites:
  - A classificação depende do requisito, capability e direitos vigentes.
  - Render determinístico não garante qualidade estética por si só.
- Riscos:
  - Geração de texto ou UI cria erros de conteúdo.
  - Usar HTML para tudo pode aumentar custo e rigidez sem benefício.
- Sinais de sucesso:
  - Cada camada possui renderer e razão documentados.
  - Fronteiras entre geração e composição aparecem no execution\-plan.
- Testes:
  - `t-requirement-routing` — cenário: Classificar requisitos de um shot em exatos, variáveis e composicionais. Resultado esperado: Elementos exatos não dependem de fidelidade gerativa; qualquer exceção exige aprovação explícita.

#### `p-exact-graphics` — Tipografia exata, UI e data visualization são locais e determinísticas

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Texto, números, labels, controles e gráficos governados devem ser construídos com conteúdo validado, fontes autorizadas e layout reproduzível.
- Intenção: Preservar significado, ortografia, hierarquia, marca e verificabilidade.
- Fontes: `w3c-css-font-loading-3`.
- Aplicabilidade:
  - Kinetic type, end cards, dashboards, tabelas, charts, preços e disclaimers.
  - Overlays em clips gerados.
- Limites:
  - Fonte precisa de licença e arquivo resolvido; nome CSS não basta.
  - Dados corretos ainda podem ser apresentados de forma enganosa.
- Riscos:
  - Fallback de fonte altera quebra, métrica e identidade.
  - Animação de gráfico sugere valores intermediários inexistentes.
- Sinais de sucesso:
  - Textos e dados no render correspondem aos inputs hasheados.
  - Fontes carregadas e métricas fazem parte do receipt.
- Testes:
  - `t-font-data-resolution` — cenário: Remover acesso à rede e renderizar com os assets declarados. Resultado esperado: Todas as fontes e fontes de dados resolvem localmente; fallback ou dado ausente falha fechado.

#### `p-alpha-compositing` — Alpha e composição precisam de contrato explícito

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Ordem de camadas, representação de alpha, premultiplicação, blend, isolamento e fundo devem ser compatíveis entre produtor, arquivo intermediário e compositor.
- Intenção: Evitar halos, bordas, cores contaminadas e resultados dependentes de interpretação implícita.
- Fontes: `w3c-compositing-1`, `ffmpeg-filters`.
- Aplicabilidade:
  - Overlays, mattes, logos, personagens recortados e transições.
  - Troca entre browser render e ferramentas de mídia.
- Limites:
  - Nem todo codec ou container preserva alpha.
  - Blend no browser e no compositor pode divergir por cor e precisão.
- Riscos:
  - Alpha interpretado de forma diferente cria franja.
  - Ordem de composição muda contraste e cor.
- Sinais de sucesso:
  - Intermediários declaram alpha e formato compatível.
  - Frames de teste sobre fundos distintos não exibem halo inesperado.
- Testes:
  - `t-alpha-roundtrip` — cenário: Compor o mesmo intermediário sobre fundos claro, escuro e colorido no pipeline real. Resultado esperado: Bordas e opacidade permanecem consistentes; divergência bloqueia a entrega híbrida.

#### `p-timeline-frame-rate` — Timeline e frame rate são racionais e imutáveis por plano

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Taxa, timebase, ranges, trims, duração e políticas de arredondamento devem ser declaradas antes do render e preservadas entre clips, tracks e composição.
- Intenção: Impedir drift, frame duplicado, lacuna e dessincronização.
- Fontes: `otio-docs`, `ffmpeg-filters`.
- Aplicabilidade:
  - Conform, render frame a frame, concatenação, captions e sincronismo.
  - Combinação de assets com frame rates ou durações distintos.
- Limites:
  - Conversão pode ser necessária, mas deve ser etapa explícita.
  - Duração em segundos decimais pode não cair em fronteira exata de frame.
- Riscos:
  - Arredondamento diferente em adapters acumula drift.
  - Retiming silencioso altera movimento e áudio.
- Sinais de sucesso:
  - Execution\-plan contém rate racional e ranges resolvidos.
  - Contagem de frames, duração e cues coincidem após composição.
- Testes:
  - `t-frame-accounting` — cenário: Calcular frames esperados por segmento e comparar com intermediários e master. Resultado esperado: Diferenças são zero ou correspondem a conversão explícita e registrada.

#### `p-color-management` — Cor precisa de espaço, transferência e conversão declarados

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Inputs, renderer, intermediários, compositor e entrega devem compartilhar ou converter explicitamente primárias, função de transferência, range e precisão relevantes.
- Intenção: Preservar aparência e dados de cor através do pipeline híbrido.
- Fontes: `w3c-css-color-4`, `ffmpeg-filters`.
- Aplicabilidade:
  - Composição browser e vídeo, assets de origens distintas, SDR ou HDR.
  - Cores de marca e overlays sobre material gerado.
- Limites:
  - Suporte real varia por browser, codec, GPU, player e display.
  - Correspondência perceptual perfeita não é inferida de metadata.
- Riscos:
  - Conversão implícita muda contraste, saturação ou cor de marca.
  - Metadata incorreta faz o player aplicar transformação errada.
- Sinais de sucesso:
  - Cada etapa registra interpretação de cor e conversão.
  - Patches e assets de controle permanecem dentro de tolerância definida.
- Testes:
  - `t-color-roundtrip` — cenário: Renderizar patches de controle e uma cor governada pelo caminho completo. Resultado esperado: Valores e aparência ficam dentro da tolerância do perfil; divergência não é corrigida silenciosamente.

#### `p-hermetic-environment` — Cache e ambiente só contam quando são herméticos

- Base epistemológica: `internal-policy`.
- Modalidade: `hard-constraint`.
- Definição: Código, dependências, browser, fontes, assets, locale, timezone, GPU policy, seeds e variáveis relevantes devem ser pinados; rede e filesystem não declarado ficam bloqueados.
- Intenção: Transformar render local em artefato reproduzível, auditável e sem exfiltração.
- Fontes: `studio-governance-hybrid`.
- Aplicabilidade:
  - HTML, CSS, Canvas e browser automation para frames ou vídeo.
  - CI provider\-free, cache de intermediários e rollback.
- Limites:
  - GPU e rasterização podem exigir equivalência visual em vez de hash bit a bit.
  - Pinning não corrige nondeterminismo do código.
- Riscos:
  - Download implícito muda saída e vaza contexto.
  - Cache sem chave completa reutiliza artefato incompatível.
- Sinais de sucesso:
  - Build offline produz a mesma classe de resultado declarada.
  - Cache key inclui todos os inputs sem segredos.
- Testes:
  - `t-offline-replay` — cenário: Repetir o render em ambiente limpo, sem rede, usando manifest e cache governados. Resultado esperado: Saída atende ao determinismClass declarado e nenhuma dependência implícita é acessada.

#### `p-assets-licenses-provenance` — Todo asset e ferramenta traz licença e provenance independentes

- Base epistemológica: `internal-policy`.
- Modalidade: `hard-constraint`.
- Definição: Fontes, imagens, áudio, código, dependências, codecs e modelos devem declarar origem, versão, termos, direitos, transformação e relação com o artefato final.
- Intenção: Impedir que capacidade técnica seja confundida com permissão de uso.
- Fontes: `studio-governance-hybrid`.
- Aplicabilidade:
  - Todo input e componente de build híbrido.
  - Export, archive, reuse e publicação.
- Limites:
  - Provenance não prova verdade nem resolve patente, marca ou consentimento.
  - Licença de software não relicencia documentação, asset ou output.
- Riscos:
  - Build opcional muda obrigações de licença.
  - Asset sem direitos entra no cache e contamina variantes.
- Sinais de sucesso:
  - SBOM ou manifest identifica build e dependências relevantes.
  - Receipt liga ingredients e actions sem incorporar segredo.
- Testes:
  - `t-license-boundary` — cenário: Auditar um master e remontar a árvore de ingredients, ferramentas e termos. Resultado esperado: Nenhum componente relevante possui origem ou direito presumido; desconhecido bloqueia uso.


### Exceções

- `x-visual-equivalence` — princípios `p-hermetic-environment`. Condição: Rasterização legítima de plataformas pinadas não permite igualdade bit a bit, mas a produção precisa suportar mais de um executor aprovado. Resposta: Declarar determinismClass de equivalência visual, tolerâncias, regiões ignoradas e evidência de comparação; não chamar o resultado de bit\-exact. Fontes: `playwright-browsers`, `studio-governance-hybrid`.

### Anti-padrões

- **Browser local como provedor oculto** (`a-browser-as-hidden-provider`): Página de render busca fonte, script, imagem, analytics ou dado pela rede durante execução sem declarar dependência, direito ou receipt.
  - Princípios: `p-exact-graphics`, `p-hermetic-environment`, `p-assets-licenses-provenance`.
  - Riscos: Saída irreproduzível, vazamento e mudança silenciosa.; Dependência ou asset sem direito entra na entrega..
  - Mitigações: Bloquear rede por padrão e empacotar assets autorizados.; Falhar fechado quando recurso declarado não está disponível..
  - Fontes: `playwright-network`, `studio-governance-hybrid`, `c2pa-spec-24`.

### Exemplos abstratos

- **Background gerado com overlay exato** (`e-generated-background-exact-overlay`): Um clip gerado autorizado fornece textura e movimento; HTML local renderiza logo, preço e gráfico com fontes pinadas; alpha e cor são compostos numa timeline de frame rate declarado.
  - Análise: O exemplo separa variação aceitável de informação exata. Originais permanecem intactos e cada etapa produz receipt e provenance.
  - Princípios: `p-renderer-routing`, `p-exact-graphics`, `p-alpha-compositing`, `p-timeline-frame-rate`, `p-color-management`, `p-assets-licenses-provenance`.
  - Fontes: `studio-governance-hybrid`, `w3c-compositing-1`, `otio-docs`, `c2pa-spec-24`.

### Contraexemplos

- **Dashboard gerado como imagem plausível** (`c-screenshot-dashboard`): Um gerador cria números e labels visualmente convincentes para representar dados que deveriam ser exatos e rastreáveis.
  - Análise: Plausibilidade visual não preserva conteúdo. Dados e tipografia pertencem ao renderer determinístico; geração pode fornecer apenas camadas que aceitem variação.
  - Princípios: `p-renderer-routing`, `p-exact-graphics`, `p-assets-licenses-provenance`.
  - Fontes: `studio-governance-hybrid`.

### Cobertura governada

- Tags obrigatórias: `generative-rendering`, `deterministic-rendering`, `hybrid-combination`, `alpha`, `compositing`, `exact-typography`, `ui`, `data-visualization`, `assets`, `frame-rate`, `color-management`, `cache`, `determinism`, `environment`, `licenses`, `provenance`.
- Mapeamento tag → princípios:
  - `alpha`: `p-alpha-compositing`.
  - `assets`: `p-exact-graphics`, `p-assets-licenses-provenance`.
  - `cache`: `p-hermetic-environment`.
  - `color-management`: `p-color-management`.
  - `compositing`: `p-alpha-compositing`.
  - `data-visualization`: `p-exact-graphics`.
  - `determinism`: `p-hermetic-environment`.
  - `deterministic-rendering`: `p-renderer-routing`, `p-hermetic-environment`.
  - `environment`: `p-hermetic-environment`.
  - `exact-typography`: `p-exact-graphics`.
  - `frame-rate`: `p-timeline-frame-rate`.
  - `generative-rendering`: `p-renderer-routing`.
  - `hybrid-combination`: `p-renderer-routing`, `p-alpha-compositing`.
  - `licenses`: `p-assets-licenses-provenance`.
  - `provenance`: `p-assets-licenses-provenance`.
  - `ui`: `p-exact-graphics`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com routing de renderer, gráficos exatos, alpha, timeline, cor, ambiente hermético e provenance.; Licença de software foi separada de documentação, assets, codecs e outputs..
- Versão 2, `2026-09-09`: Nova versão candidata para distribuição familiar: vínculo com a política sanitizada do workspace. Conteúdo técnico e termos preservados; nenhuma ativação ou promoção..

## `motion-foundations@1` — Fundamentos de motion design

- Lifecycle editorial: `candidate`.
- Hash canônico: `aa4a68930191bb7b243ce98c80c64f64ecd9e19d0f9cb38cf06169e707c0c73e`.
- Arquivo: `motion-foundations@1.domain-pack.json`; SHA-256 `7546559ea774db25ee5bbabe1927f682fcc36075623116787b665c959e3c5b92`.
- Resumo: Vocabulário técnico neutro para organizar espaço, tempo, movimento e percepção sem prescrever uma estética, um criador ou uma ferramenta.
- Domínios: `motion-design`, `visual-language`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 29/29 tags declaradas/requeridas.

### Aplicabilidade

- Planejamento e revisão de motion graphics em modo Studio.
- Composição determinística e direção de clipes gerados.
- Discussão técnica de legibilidade, continuidade e sincronismo.

### Exclusões

- Imitação de criadores, obras ou estilos reconhecíveis.
- Garantia de desempenho comercial.
- Correção automática, regeneração ou consumo autônomo de cota.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `acm-traditional-animation-1987` | [Principles of traditional animation applied to 3D computer animation](<https://doi.org/10.1145/37401.37407>) | `bibliography` | Association for Computing Machinery | `SIGGRAPH 1987 paper` | `citation-only` | known / ACM\-Copyright\-Policy; [termos](<https://www.acm.org/publications/policies/copyright-policy>); acesso `2026-07-24T14:32:31Z`; Referência bibliográfica para a existência de princípios clássicos de animação. Não há citação textual, reprodução de figuras nem transformação do artigo em fórmula estética. | sem snapshot local |
| `ebu-r95` | [EBU R 95: Safe areas for 16:9 television production](<https://tech.ebu.ch/docs/r/r095.pdf>) | `external-standard` | European Broadcasting Union | não declarada | `factual-extraction-only` | known / EBU\-Terms\-of\-Use; [termos](<https://www.ebu.ch/cms/live/live/en/sites/ebu/terms-of-use.html>); acesso `2026-07-24T14:32:31Z`; Fonte protegida. Uso restrito à constatação de que safe areas são um requisito de entrega específico; percentuais, diagramas e texto não são reutilizados. | sem snapshot local |
| `film-art-13` | [Film Art: An Introduction](<https://www.mheducation.com/highered/product/Film-Art-An-Introduction-Bordwell.html>) | `bibliography` | McGraw Hill | `13th edition` | `citation-only` | unknown; acesso `2026-07-24T14:32:31Z`; Referência bibliográfica para composição de plano, cinematografia, montagem, continuidade, ritmo e relações audiovisuais. Nenhum trecho, imagem, exemplo de filme ou estrutura do livro é reutilizado. | sem snapshot local |
| `w3c-css-easing-2` | [CSS Easing Functions Level 2](<https://www.w3.org/TR/css-easing-2/>) | `external-draft-specification` | World Wide Web Consortium | não declarada | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Base factual para progressão temporal e curvas de easing; valores criativos e exemplos deste pack são originais. | sem snapshot local |
| `w3c-wcag-22` | [Web Content Accessibility Guidelines 2.2](<https://www.w3.org/TR/WCAG22/>) | `external-standard` | World Wide Web Consortium | `W3C Recommendation` | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Referência de acessibilidade para contraste, animação acionada por interação e risco de flashes. Aplicação a MP4 ou broadcast deve ser avaliada no perfil de entrega, sem alegação automática de conformidade WCAG. | sem snapshot local |
| `w3c-web-animations-2023` | [Web Animations Level 1](<https://www.w3.org/TR/2023/WD-web-animations-1-20230605/>) | `external-draft-specification` | World Wide Web Consortium | `Working Draft 5 June 2023` / `2023-06-05` | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Usada somente para conceitos factuais de tempo, progresso, keyframes e composição de efeitos. O pack não reproduz algoritmos, exemplos ou texto normativo. | sem snapshot local |

### Definições

- **Staging** (`def-staging`; base `source-grounded`): Organização deliberada de atenção, posição, profundidade e tempo para tornar clara a ação ou ideia principal de um plano. Fontes: `acm-traditional-animation-1987`.
- **Easing** (`def-easing`; base `source-grounded`): Função que transforma o progresso temporal linear em outra progressão, alterando a percepção de aceleração, desaceleração e ênfase sem mudar necessariamente a duração total. Fontes: `w3c-css-easing-2`, `w3c-web-animations-2023`.
- **Safe area** (`def-safe-area`; base `source-grounded`): Região operacional definida por um perfil de entrega para reduzir o risco de elementos essenciais serem ocultados, cortados ou sobrepostos por interface e exibição. Fontes: `ebu-r95`.

### Princípios

#### `p-spatial-hierarchy` — Hierarquia espacial serve à intenção

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Composição, contraste, balanço, escala e espaço negativo devem estabelecer uma ordem de leitura compatível com a intenção do plano.
- Intenção: Fazer o espectador localizar primeiro o elemento principal e compreender relações secundárias sem depender de ornamentação.
- Fontes: `w3c-wcag-22`.
- Aplicabilidade:
  - Planos com texto, produto, personagem, dados ou múltiplas camadas.
  - Keyframes usados como contrato visual antes da animação.
- Limites:
  - Ambiguidade pode ser intencional em obra expressiva.
  - Contraste perceptivo depende do dispositivo, ambiente e perfil de entrega.
- Riscos:
  - Muitos focos equivalentes diluem a mensagem.
  - Escala sem contexto pode parecer erro de continuidade.
- Sinais de sucesso:
  - O foco primário é identificável no frame estático.
  - A ordem de leitura permanece estável nos momentos decisivos.
- Testes:
  - `t-primary-focus` — cenário: Remover o movimento e observar três frames representativos do plano. Resultado esperado: Cada frame mantém foco principal identificável e elementos secundários não competem sem intenção declarada.

#### `p-readable-type-color` — Texto e cor permanecem funcionais durante o movimento

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Tipografia em movimento deve preservar tempo de leitura, contraste, integridade das formas e posição segura conforme o canal, usando cor como informação redundante quando necessário.
- Intenção: Evitar que movimento, recorte, compressão ou interface destruam conteúdo essencial.
- Fontes: `w3c-wcag-22`, `ebu-r95`.
- Aplicabilidade:
  - Títulos, legendas, preço, CTA, disclaimers e dados.
  - Entregas com múltiplas proporções ou sobreposição de UI.
- Limites:
  - Safe area não é universal; deve vir do perfil vigente do canal.
  - WCAG é referência web e não prova conformidade de todo arquivo audiovisual.
- Riscos:
  - Texto essencial fora da área segura pode desaparecer.
  - Cor usada como único sinal pode excluir parte da audiência.
- Sinais de sucesso:
  - Conteúdo essencial permanece legível em escala de visualização alvo.
  - Nenhum significado crítico depende apenas de cor ou de um frame muito breve.
- Testes:
  - `t-text-window` — cenário: Verificar os intervalos completos em que cada texto essencial está visível no aspect ratio de entrega. Resultado esperado: O texto permanece íntegro, dentro da safe area declarada e por tempo compatível com sua extensão.

#### `p-temporal-shaping` — Timing, spacing, easing e holds expressam função

- Base epistemológica: `source-grounded`.
- Modalidade: `heuristic`.
- Definição: Duração, distribuição espacial entre amostras, curva de progresso e pausas devem ser escolhidas em conjunto para comunicar peso, precisão, urgência ou contemplação.
- Intenção: Transformar uma mudança de estado em movimento legível e motivado.
- Fontes: `w3c-web-animations-2023`, `w3c-css-easing-2`, `acm-traditional-animation-1987`.
- Aplicabilidade:
  - Animação de propriedades, câmera, transições e entrada ou saída de elementos.
  - Sincronização com fala, música ou eventos narrativos.
- Limites:
  - Não existe uma curva universalmente natural.
  - Holds longos ou movimentos lineares podem ser escolhas corretas quando motivados.
- Riscos:
  - Easing decorativo pode conflitar com a intenção.
  - Aceleração excessiva reduz legibilidade e cria ruído.
- Sinais de sucesso:
  - A velocidade percebida é compatível com a função do elemento.
  - Pausas coincidem com momentos de compreensão ou ênfase.
- Testes:
  - `t-motion-function` — cenário: Descrever em uma frase a função de cada movimento relevante e comparar com sua curva e duração. Resultado esperado: Cada curva, spacing e hold possui justificativa funcional; movimentos sem função são removíveis sem perda.

#### `p-preparation-and-settle` — Preparação, ultrapassagem e continuidade devem ser proporcionais

- Base epistemológica: `source-grounded`.
- Modalidade: `heuristic`.
- Definição: Antecipação prepara a leitura; overshoot indica energia ou elasticidade; follow\-through e overlap distribuem a parada entre partes relacionadas.
- Intenção: Tornar mudanças de ação compreensíveis e coerentes com material, massa e tom.
- Fontes: `acm-traditional-animation-1987`.
- Aplicabilidade:
  - Personagens, objetos articulados, logos, interfaces e câmera.
  - Movimentos que precisam comunicar impulso ou dissipação.
- Limites:
  - Movimento mecânico, solene ou preciso pode exigir pouca ou nenhuma ultrapassagem.
  - Logo e identidade podem proibir deformação ou elasticidade.
- Riscos:
  - Aplicação automática produz movimento infantilizado ou inconsistente.
  - Excesso de overlap obscurece a ação principal.
- Sinais de sucesso:
  - A ação principal é percebida antes dos movimentos secundários.
  - O assentamento preserva forma, identidade e materialidade declaradas.
- Testes:
  - `t-settle-proportion` — cenário: Comparar o movimento principal, sua preparação e seu assentamento com as restrições do elemento. Resultado esperado: Componentes secundários reforçam a ação sem atrasar a leitura nem violar integridade de marca.

#### `p-path-and-staging` — Trajetória, arcos, câmera e staging compartilham a atenção

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Caminhos de elementos e câmera devem preservar geografia, evitar colisões sem intenção e conduzir o olhar por uma sequência espacial compreensível.
- Intenção: Organizar deslocamento como linguagem e não como efeito isolado.
- Fontes: `acm-traditional-animation-1987`, `film-art-13`.
- Aplicabilidade:
  - Planos com câmera virtual, objetos móveis ou revelações.
  - Transições que reutilizam direção ou forma.
- Limites:
  - Trajetórias quebradas podem comunicar choque, erro ou artificialidade.
  - Nem todo movimento precisa seguir arco.
- Riscos:
  - Câmera e objeto competindo pela atenção tornam o plano ilegível.
  - Mudança de eixo não motivada quebra orientação.
- Sinais de sucesso:
  - O espectador consegue apontar origem, destino e foco do movimento.
  - A câmera revela informação sem esconder a ação principal.
- Testes:
  - `t-trajectory-map` — cenário: Sobrepor trajetórias simplificadas do foco, elementos secundários e câmera. Resultado esperado: As trajetórias formam uma ordem de atenção coerente e colisões relevantes são intencionais.

#### `p-depth-parallax` — Profundidade e parallax exigem modelo espacial coerente

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Diferenças de escala, oclusão, foco e velocidade relativa devem concordar o suficiente para sustentar a profundidade pretendida.
- Intenção: Criar separação espacial sem introduzir contradições visuais gratuitas.
- Fontes: `film-art-13`.
- Aplicabilidade:
  - Câmera multiplano, colagem, ambientes 2.5D e composição de camadas.
  - Revelações em que foreground, midground e background têm funções distintas.
- Limites:
  - Colagem e abstração podem usar perspectiva deliberadamente inconsistente.
  - Parallax mínimo pode ser preferível para conforto e legibilidade.
- Riscos:
  - Velocidades incompatíveis fazem camadas parecerem soltas.
  - Oclusão inesperada encobre informação essencial.
- Sinais de sucesso:
  - Camadas mantêm relação espacial estável durante o plano.
  - A profundidade reforça foco e não depende de movimento excessivo.
- Testes:
  - `t-layer-coherence` — cenário: Inspecionar início, meio e fim de uma câmera multiplano. Resultado esperado: Ordem de oclusão, escala e velocidade relativa permanecem coerentes com o modelo espacial declarado.

#### `p-continuity-transition` — Continuidade decide o que a transição preserva

- Base epistemológica: `source-grounded`.
- Modalidade: `heuristic`.
- Definição: Cortes e transições devem declarar se preservam ação, direção, forma, cor, posição, tempo ou ideia; match cut é um caso de continuidade baseada em correspondência perceptiva.
- Intenção: Fazer a passagem entre planos carregar significado ou economia, não apenas decoração.
- Fontes: `film-art-13`.
- Aplicabilidade:
  - Sequências, montagens, variantes de aspect ratio e mudanças de cena.
  - Transições geradas ou compostas localmente.
- Limites:
  - Descontinuidade pode ser recurso narrativo deliberado.
  - Correspondência formal não substitui continuidade factual em documentário.
- Riscos:
  - Transição complexa mascara uma relação narrativa fraca.
  - Match cut aproximado pode parecer erro de posição.
- Sinais de sucesso:
  - É possível nomear a relação preservada ou rompida.
  - A transição não cria ambiguidade involuntária sobre tempo, espaço ou identidade.
- Testes:
  - `t-transition-contract` — cenário: Para cada transição, registrar o atributo preservado e o atributo que pode mudar. Resultado esperado: O resultado observado respeita o contrato ou a ruptura está explicitamente motivada.

#### `p-rhythm-sync` — Ritmo audiovisual organiza eventos, não apenas batidas

- Base epistemológica: `source-grounded`.
- Modalidade: `heuristic`.
- Definição: Ritmo resulta de densidade, duração, repetição, silêncio e mudança; sincronismo pode alinhar eventos com fala, música ou ação, mas também usar contraponto intencional.
- Intenção: Coordenar percepção visual e sonora sem transformar toda edição em marcação mecânica de beat.
- Fontes: `film-art-13`.
- Aplicabilidade:
  - Montagem musical, kinetic type, fala com gráficos e efeitos pontuais.
  - Sequências que alternam densidade ou pausa.
- Limites:
  - Sincronia perfeita pode reduzir naturalidade.
  - Ausência de música não implica ausência de ritmo.
- Riscos:
  - Marcar cada batida torna a peça previsível.
  - Eventos visuais concorrentes com palavras essenciais reduzem compreensão.
- Sinais de sucesso:
  - Eventos importantes têm relação temporal observável com a intenção sonora.
  - Pausas e contrapontos são percebidos como escolha, não como atraso.
- Testes:
  - `t-av-event-map` — cenário: Mapear eventos visuais e sonoros principais numa mesma timeline. Resultado esperado: Alinhamentos e desvios relevantes têm função declarada e não ocultam fala ou texto essencial.


### Exceções

- `x-deliberate-disorientation` — princípios `p-path-and-staging`, `p-continuity-transition`. Condição: A obra precisa produzir desorientação como efeito narrativo explicitamente aprovado. Resposta: Registrar a intenção, preservar requisitos de segurança e acessibilidade e limitar a ruptura ao trecho necessário. Fontes: `w3c-wcag-22`.

### Anti-padrões

- **Princípio convertido em fórmula estética** (`a-style-by-default`): Aplicar sempre o mesmo easing, overshoot, parallax ou transição sem relação com intenção, material ou canal.
  - Princípios: `p-temporal-shaping`, `p-preparation-and-settle`, `p-depth-parallax`, `p-continuity-transition`.
  - Riscos: Uniformização de peças distintas.; Movimento incompatível com marca, narrativa ou acessibilidade..
  - Mitigações: Exigir função declarada para decisões relevantes.; Permitir movimento linear, corte seco ou ausência de movimento quando adequados..
  - Fontes: `w3c-css-easing-2`, `acm-traditional-animation-1987`.

### Exemplos abstratos

- **Revelação com foco preservado** (`e-product-reveal`): Um elemento entra por trajetória curta, desacelera antes do hold e deixa espaço negativo para uma mensagem essencial dentro da safe area do canal.
  - Análise: O exemplo combina técnica e intenção sem prescrever aparência. Trajetória, hold e espaço são verificáveis; valores concretos dependem do plano e do perfil de entrega.
  - Princípios: `p-spatial-hierarchy`, `p-temporal-shaping`, `p-path-and-staging`, `p-readable-type-color`.
  - Fontes: `w3c-css-easing-2`, `ebu-r95`, `film-art-13`.

### Contraexemplos

- **Movimento concorrente sem hierarquia** (`c-competing-motion`): Título, fundo, câmera e elemento principal aceleram em direções distintas durante a única janela de leitura.
  - Análise: O movimento não é inválido por ser intenso; falha porque a peça não declara foco nem oferece tempo alternativo para a mensagem essencial.
  - Princípios: `p-spatial-hierarchy`, `p-readable-type-color`, `p-rhythm-sync`.
  - Fontes: `w3c-wcag-22`, `film-art-13`.

### Cobertura governada

- Tags obrigatórias: `composition`, `visual-hierarchy`, `contrast`, `balance`, `scale`, `negative-space`, `motion-typography`, `color`, `staging`, `timing`, `spacing`, `easing`, `anticipation`, `overshoot`, `follow-through`, `overlap`, `holds`, `arcs`, `trajectory`, `camera`, `depth`, `parallax`, `continuity`, `match-cut`, `transitions`, `rhythm`, `audiovisual-synchronization`, `readability`, `safe-areas`.
- Mapeamento tag → princípios:
  - `anticipation`: `p-preparation-and-settle`.
  - `arcs`: `p-path-and-staging`.
  - `audiovisual-synchronization`: `p-rhythm-sync`.
  - `balance`: `p-spatial-hierarchy`.
  - `camera`: `p-path-and-staging`.
  - `color`: `p-readable-type-color`.
  - `composition`: `p-spatial-hierarchy`.
  - `continuity`: `p-continuity-transition`.
  - `contrast`: `p-spatial-hierarchy`, `p-readable-type-color`.
  - `depth`: `p-depth-parallax`.
  - `easing`: `p-temporal-shaping`.
  - `follow-through`: `p-preparation-and-settle`.
  - `holds`: `p-temporal-shaping`.
  - `match-cut`: `p-continuity-transition`.
  - `motion-typography`: `p-readable-type-color`.
  - `negative-space`: `p-spatial-hierarchy`.
  - `overlap`: `p-preparation-and-settle`.
  - `overshoot`: `p-preparation-and-settle`.
  - `parallax`: `p-depth-parallax`.
  - `readability`: `p-readable-type-color`.
  - `rhythm`: `p-rhythm-sync`.
  - `safe-areas`: `p-readable-type-color`.
  - `scale`: `p-spatial-hierarchy`, `p-depth-parallax`.
  - `spacing`: `p-temporal-shaping`.
  - `staging`: `p-path-and-staging`.
  - `timing`: `p-temporal-shaping`.
  - `trajectory`: `p-path-and-staging`.
  - `transitions`: `p-continuity-transition`.
  - `visual-hierarchy`: `p-spatial-hierarchy`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com cobertura fundacional, testes abstratos e fontes com termos separados da licença do pack.; Princípios formulados de modo neutro, não imitativo e sem valores estéticos universais..

## `short-film-language@1` — Linguagem de pequenos filmes

- Lifecycle editorial: `candidate`.
- Hash canônico: `3de5147cfdc8efa1a46bb3315e173b7d6d2e5b80cce48b2fae4f061baefafe77`.
- Arquivo: `short-film-language@1.domain-pack.json`; SHA-256 `c7b6b27ab5e0f819505d832e43a49bdb66137488f946728d48a2e7b51a7d8bbb`.
- Resumo: Vocabulário flexível para condensar premissa, personagem, cena, virada, ponto de vista, montagem e som em narrativas curtas sem impor fórmula dramática universal.
- Domínios: `short-film`, `narrative`, `film-language`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 21/21 tags declaradas/requeridas.

### Aplicabilidade

- Curtas de ficção, microfilmes, histórias de marca e narrativas explicativas.
- Desenvolvimento de brief, film\-spec, cenas e montagem em modo Studio.
- Discussão de economia narrativa para durações limitadas.

### Exclusões

- Fórmula obrigatória de roteiro, gênero, estrutura ou final.
- Imitação de filmes, roteiristas, diretores ou escolas reconhecíveis.
- Garantia de emoção, retenção, premiação ou performance.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `film-art-13` | [Film Art: An Introduction](<https://www.mheducation.com/highered/product/Film-Art-An-Introduction-Bordwell.html>) | `bibliography` | McGraw Hill | `13th edition` | `citation-only` | unknown; acesso `2026-07-24T14:32:31Z`; Referência bibliográfica para forma narrativa, mise\-en\-scène, cinematografia, montagem e som. Nenhum trecho, diagrama, exemplo de filme ou estrutura do livro é reutilizado. | sem snapshot local |
| `otio-docs` | [OpenTimelineIO Documentation](<https://opentimelineio.readthedocs.io/en/latest/index.html>) | `external-guidance` | Academy Software Foundation | `Documentation current at access date` | `paraphrase-only` | known / Apache\-2.0; [termos](<https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/LICENSE.txt>); acesso `2026-07-24T14:32:31Z`; Usada somente para fatos sobre representação de timeline, clips, tracks, transitions, markers e referências externas de mídia; conceitos narrativos são síntese original. | sem snapshot local |
| `otio-time-ranges` | [OpenTimelineIO Time Ranges](<https://opentimelineio.readthedocs.io/en/latest/tutorials/time-ranges.html>) | `external-guidance` | Academy Software Foundation | não declarada | `paraphrase-only` | known / Apache\-2.0; [termos](<https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/LICENSE.txt>); acesso `2026-07-24T14:32:31Z`; Base técnica para distinguir duração, faixa disponível e faixa usada. Nenhum código ou exemplo é copiado. | sem snapshot local |

### Definições

- **Premissa** (`def-premise`; base `editorial-synthesis`): Condição dramática mínima que combina sujeito, situação e mudança potencial; descreve o terreno da história sem resolver sua forma. Fontes: `film-art-13`.
- **Beat** (`def-beat`; base `editorial-synthesis`): Unidade perceptível de mudança em informação, objetivo, emoção, poder ou ação; sua duração pode ir de um gesto a uma sequência. Fontes: `film-art-13`, `otio-time-ranges`.
- **Função de cena** (`def-scene-function`; base `editorial-synthesis`): Contribuição específica de uma cena para a experiência total, como revelar, complicar, decidir, contrastar, preparar, transformar ou concluir. Fontes: `film-art-13`.

### Princípios

#### `p-premise-theme-logline` — Premissa, tema e logline respondem perguntas diferentes

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Premissa define a condição dramática; tema nomeia uma questão de sentido; logline comprime protagonista, movimento e obstáculo sem pretender substituir a história.
- Intenção: Dar ao projeto uma direção compartilhada antes de acumular cenas e imagens.
- Fontes: `film-art-13`.
- Aplicabilidade:
  - Desenvolvimento de conceito, pitch, brief e film\-spec.
  - Revisão de coerência entre início, transformação e final.
- Limites:
  - Histórias atmosféricas podem não ter protagonista ou objetivo convencional.
  - Tema pode emergir e mudar durante o desenvolvimento.
- Riscos:
  - Logline excessivamente completa elimina descoberta.
  - Tema enunciado como slogan pode reduzir ambiguidade produtiva.
- Sinais de sucesso:
  - Os três campos são distintos, compatíveis e revisáveis.
  - Cenas propostas podem ser avaliadas contra a condição e a questão central.
- Testes:
  - `t-three-statements` — cenário: Escrever separadamente premissa, tema e logline em uma frase cada. Resultado esperado: As frases não são sinônimas e nenhuma exige uma fórmula estrutural específica.

#### `p-character-forces` — Personagem se torna legível pelas forças em conflito

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Desejo orienta ação consciente; necessidade descreve transformação possível; obstáculo cria resistência; stakes tornam compreensível o custo de agir ou não agir.
- Intenção: Fazer caráter e conflito aparecerem por escolhas observáveis, não apenas por explicação.
- Fontes: `film-art-13`.
- Aplicabilidade:
  - Narrativas centradas em pessoa, personagem, grupo ou agente abstrato.
  - Cenas em que decisão e consequência sustentam atenção.
- Limites:
  - Desejo e necessidade podem coincidir, permanecer ambíguos ou não se resolver.
  - Stakes íntimos podem ser suficientes; escala não equivale a importância.
- Riscos:
  - Obstáculo arbitrário parece mecanismo de roteiro.
  - Explicar a necessidade antes que a ação a revele reduz participação do público.
- Sinais de sucesso:
  - É possível identificar o que muda nas escolhas do personagem.
  - Consequências são proporcionais ao mundo da história.
- Testes:
  - `t-choice-under-pressure` — cenário: Localizar a principal escolha sob pressão e retirar a fala explicativa correspondente. Resultado esperado: A ação ainda revela desejo, resistência ou mudança de prioridade.

#### `p-arc-and-beats` — Arco emerge da sequência de beats

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Arco é a diferença significativa entre estados; beats são mudanças locais que constroem, contestam ou recusam essa diferença.
- Intenção: Planejar transformação em unidades observáveis sem exigir trajetória positiva ou completa.
- Fontes: `film-art-13`, `otio-time-ranges`.
- Aplicabilidade:
  - Histórias com transformação, revelação, ciclo, queda ou resistência.
  - Animatics e timelines que precisam expor densidade de eventos.
- Limites:
  - Arco pode pertencer à percepção do público, não ao personagem.
  - Narrativa episódica ou poética pode operar por acumulação.
- Riscos:
  - Beats redundantes ocupam duração sem mudar estado.
  - Forçar transformação contradiz personagem ou tema.
- Sinais de sucesso:
  - Cada beat material altera ao menos uma relação relevante.
  - O estado final responde ao estado inicial, mesmo sem fechamento total.
- Testes:
  - `t-state-diff` — cenário: Descrever o estado antes e depois de cada beat em termos verificáveis. Resultado esperado: Beats sem mudança ou preparação identificável podem ser combinados, removidos ou justificados.

#### `p-scene-turn` — Cena concentra função e termina diferente de como começou

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Uma cena útil possui função dominante e ao menos uma virada de informação, objetivo, relação, emoção ou ação; a virada pode ser mínima e não precisa ser surpresa.
- Intenção: Evitar cenas que apenas repetem contexto ou ilustram uma frase.
- Fontes: `film-art-13`, `otio-docs`.
- Aplicabilidade:
  - Decupagem, storyboard, film\-spec e montagem.
  - Curtas com poucos planos ou cenas muito breves.
- Limites:
  - Cena contemplativa pode ter função de duração, presença ou contraste.
  - Uma cena pode sustentar mais de uma função, desde que não perca foco.
- Riscos:
  - Viradas artificiais tornam a história mecânica.
  - Exposição repetida reduz economia narrativa.
- Sinais de sucesso:
  - A função cabe em uma frase operacional.
  - O ponto de saída acontece depois de uma mudança perceptível.
- Testes:
  - `t-scene-before-after` — cenário: Registrar função, estado de entrada e estado de saída para cada cena. Resultado esperado: A cena muda ou prepara algo necessário; repetição sem função é sinalizada para revisão humana.

#### `p-climax-resolution` — Clímax concentra consequência; resolução mostra o novo estado

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Clímax é o ponto de maior consequência para a questão construída; resolução oferece informação suficiente sobre o estado resultante, podendo permanecer aberta.
- Intenção: Fechar a experiência prometida sem confundir volume ou espetáculo com consequência.
- Fontes: `film-art-13`.
- Aplicabilidade:
  - Narrativas com pergunta, escolha, confronto ou revelação acumulada.
  - Peças curtas que precisam terminar sem epílogo extenso.
- Limites:
  - Obras cíclicas, poéticas ou anticlímax deliberado podem deslocar a consequência.
  - Resolução não exige explicar o tema.
- Riscos:
  - Clímax visual sem relação com o conflito central.
  - Resolução longa repete uma conclusão já percebida.
- Sinais de sucesso:
  - O ponto de maior consequência responde ao que foi preparado.
  - O último estado é percebido por ação, imagem ou som suficiente.
- Testes:
  - `t-consequence-chain` — cenário: Traçar do clímax para trás as preparações necessárias e para frente a consequência principal. Resultado esperado: A cadeia existe sem depender de informação introduzida apenas no final.

#### `p-pov-geography-continuity` — Ponto de vista organiza câmera, geografia e continuidade

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Posição de câmera, escala de plano, direção, eixo, duração e montagem devem controlar o que o público sabe, sente e localiza a cada momento.
- Intenção: Usar linguagem de câmera e edição para experiência, não como inventário de planos.
- Fontes: `film-art-13`, `otio-docs`.
- Aplicabilidade:
  - Decupagem de ação, conversa, espaço e revelação.
  - Sequências geradas em partes que precisam preservar relações.
- Limites:
  - Quebra de eixo, salto e geografia incompleta podem ser escolhas expressivas.
  - Continuidade visual não corrige contradição narrativa.
- Riscos:
  - Cobertura sem ponto de vista fragmenta a experiência.
  - Mudanças não motivadas de posição confundem identidade e direção.
- Sinais de sucesso:
  - O público recebe informação espacial suficiente para a ação relevante.
  - Mudanças de ponto de vista correspondem a mudança de conhecimento ou relação.
- Testes:
  - `t-spatial-knowledge` — cenário: Para cada corte, registrar o que o público sabe antes e depois sobre posição, direção e relação. Resultado esperado: A mudança preserva orientação necessária ou a desorientação tem função declarada.

#### `p-sound-and-economy` — Som e economia narrativa dividem o trabalho

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Diálogo, ambiente, silêncio, música e efeito podem introduzir espaço, tempo, elipse, ponto de vista e consequência, permitindo remover imagem ou exposição redundante.
- Intenção: Fazer a curta duração concentrar experiência, não apenas acelerar eventos.
- Fontes: `film-art-13`, `otio-docs`.
- Aplicabilidade:
  - Roteiro audiovisual, desenho de som, montagem e animatic.
  - Microfilmes em que cada plano precisa cumprir mais de uma função compatível.
- Limites:
  - Densidade máxima não é objetivo; pausa pode ser o uso mais econômico do tempo.
  - Informação sonora essencial requer estratégia de captions e acessibilidade.
- Riscos:
  - Música explica emoção já evidente.
  - Som fora de campo cria fato narrativo não sustentado pelo projeto.
- Sinais de sucesso:
  - Imagem e som se complementam em vez de duplicar tudo.
  - Elipses preservam relações necessárias e liberam duração para momentos decisivos.
- Testes:
  - `t-redundancy-pass` — cenário: Marcar toda informação repetida simultaneamente por fala, texto, imagem e música. Resultado esperado: Redundância é mantida apenas quando melhora clareza, acessibilidade ou ênfase intencional.


### Exceções

- `x-noncharacter-form` — princípios `p-character-forces`, `p-arc-and-beats`, `p-climax-resolution`. Condição: A obra aprovada é poética, ensaística, processual ou abstrata e não organiza sua experiência por personagem ou clímax. Resposta: Substituir as perguntas de personagem por progressão perceptiva, associação, repetição e mudança de estado, sem fingir os campos ausentes. Fontes: `film-art-13`.

### Anti-padrões

- **Template antes da premissa** (`a-template-before-premise`): Preencher beats, viradas e clímax por obrigação antes de compreender condição, ponto de vista e experiência desejada.
  - Princípios: `p-premise-theme-logline`, `p-arc-and-beats`, `p-scene-turn`, `p-climax-resolution`.
  - Riscos: Histórias diferentes assumem a mesma forma superficial.; Eventos existem para satisfazer campos, não para mudar relações..
  - Mitigações: Tratar princípios como perguntas e hipóteses.; Registrar exceção quando a forma pede acumulação, ciclo ou abertura..
  - Fontes: `film-art-13`.

### Exemplos abstratos

- **Curta organizado por uma escolha** (`e-one-choice-short`): Uma situação apresenta desejo e obstáculo; dois beats mudam o custo; uma escolha concentra a consequência; imagem e som finais mostram o novo estado sem explicação adicional.
  - Análise: A estrutura é uma possibilidade abstrata, não um número obrigatório de beats. A economia vem da relação causal e da divisão de informação entre imagem e som.
  - Princípios: `p-character-forces`, `p-arc-and-beats`, `p-climax-resolution`, `p-sound-and-economy`.
  - Fontes: `film-art-13`, `otio-docs`.

### Contraexemplos

- **Cobertura sem ponto de vista** (`c-coverage-without-viewpoint`): A sequência alterna planos gerais, médios e detalhes disponíveis, mas nenhum corte muda conhecimento, relação ou geografia.
  - Análise: Variedade de enquadramento não equivale a linguagem. A montagem acumula cobertura, mas não constrói experiência ou mudança.
  - Princípios: `p-scene-turn`, `p-pov-geography-continuity`, `p-sound-and-economy`.
  - Fontes: `film-art-13`, `otio-docs`.

### Cobertura governada

- Tags obrigatórias: `premise`, `theme`, `logline`, `character`, `desire`, `need`, `obstacle`, `stakes`, `arc`, `beats`, `scene-function`, `turn`, `climax`, `resolution`, `point-of-view`, `geography`, `continuity`, `camera-language`, `editing`, `sound-design`, `narrative-economy`.
- Mapeamento tag → princípios:
  - `arc`: `p-arc-and-beats`.
  - `beats`: `p-arc-and-beats`.
  - `camera-language`: `p-pov-geography-continuity`.
  - `character`: `p-character-forces`.
  - `climax`: `p-climax-resolution`.
  - `continuity`: `p-pov-geography-continuity`.
  - `desire`: `p-character-forces`.
  - `editing`: `p-scene-turn`, `p-pov-geography-continuity`.
  - `geography`: `p-pov-geography-continuity`.
  - `logline`: `p-premise-theme-logline`.
  - `narrative-economy`: `p-sound-and-economy`, `p-scene-turn`.
  - `need`: `p-character-forces`.
  - `obstacle`: `p-character-forces`.
  - `point-of-view`: `p-pov-geography-continuity`.
  - `premise`: `p-premise-theme-logline`.
  - `resolution`: `p-climax-resolution`.
  - `scene-function`: `p-scene-turn`.
  - `sound-design`: `p-sound-and-economy`.
  - `stakes`: `p-character-forces`.
  - `theme`: `p-premise-theme-logline`.
  - `turn`: `p-scene-turn`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com vocabulário de narrativa curta, ponto de vista, montagem, som e economia.; Princípios são heurísticas abertas e fontes de craft permanecem apenas bibliográficas..

## `sound-and-music@2` — Som, voz e música

- Lifecycle editorial: `candidate`.
- Hash canônico: `ac7b3d4cde44b6490c12522d7268bf0f788a0e7299e4da46a7558e954ecfbc9d`.
- Arquivo: `sound-and-music@2.domain-pack.json`; SHA-256 `77a3c5919ea7a294ebcff7acb91bb6f6ae939adaf33f773ca7c04f7f591b1dae`.
- Resumo: Fundamentos para intenção vocal, inteligibilidade, ritmo, música, efeitos, sincronismo, mix, loudness, acessibilidade e restrições operacionais do Studio.
- Domínios: `sound`, `music`, `audio-post`.
- Autores: Codex assisted draft (`codex-assisted-draft`).
- Revisores: nenhum; candidato ainda não aprovado.
- Revisado em: não revisado.
- Licença do pack: `MKT-Videos-Proprietary-Knowledge@1` (`custom`).
- Termos do pack: contrato governado (`urn:mkt-videos:governance:domain-pack-terms`); hash `31e675b5cfc5718e34427a63953b29317b2d535ef77650b35ba9537d9457d31f`.
- Dependências: nenhuma.
- Cobertura: 18/18 tags declaradas/requeridas.

### Aplicabilidade

- Direção de voz, desenho de som, trilha, mix, captions e entrega em modo Studio.
- Planejamento audio\-first e sincronização de eventos audiovisuais.
- Perfis de loudness e true peak definidos pelo destino.

### Exclusões

- Geração silenciosa de TTS, música ou QA sem flag explícita e recibo.
- Meta universal de loudness para todos os canais.
- Repetição automática de tentativa ambígua ou falha de provedor.

### Fontes e termos

| ID | Fonte | Tipo | Autoridade | Versão/data | Uso | Termos | Atestação |
|---|---|---|---|---|---|---|---|
| `ebu-r128-v5` | [EBU R 128: Loudness normalisation and permitted maximum level of audio signals](<https://tech.ebu.ch/docs/r/r128.pdf>) | `external-standard` | European Broadcasting Union | `Version 5, November 2023` | `factual-extraction-only` | known / EBU\-Terms\-of\-Use; [termos](<https://www.ebu.ch/cms/live/live/en/sites/ebu/terms-of-use.html>); acesso `2026-07-24T14:32:31Z`; Fonte protegida. Usada para distinguir uma recomendação broadcast de um alvo universal; nenhum valor é imposto fora do perfil que adota R 128. | sem snapshot local |
| `ebu-r128s1` | [EBU R 128 s1: Loudness parameters for short\-form content](<https://tech.ebu.ch/publications/r128s1>) | `external-standard` | European Broadcasting Union | `Version 3` | `factual-extraction-only` | known / EBU\-Terms\-of\-Use; [termos](<https://www.ebu.ch/cms/live/live/en/sites/ebu/terms-of-use.html>); acesso `2026-07-24T14:32:31Z`; Fonte protegida usada somente para registrar que conteúdo curto pode exigir parâmetros adicionais dentro de fluxos EBU. Sem reprodução de valores, tabelas ou texto. | sem snapshot local |
| `ebu-tech3341` | [EBU Tech 3341: Loudness Metering](<https://tech.ebu.ch/docs/tech/tech3341.pdf>) | `external-standard` | European Broadcasting Union | não declarada | `factual-extraction-only` | known / EBU\-Terms\-of\-Use; [termos](<https://www.ebu.ch/cms/live/live/en/sites/ebu/terms-of-use.html>); acesso `2026-07-24T14:32:31Z`; Referência protegida para práticas de medição em contexto EBU. O pack não reproduz especificações. | sem snapshot local |
| `ffmpeg-filters` | [FFmpeg Filters Documentation](<https://ffmpeg.org/ffmpeg-filters.html>) | `external-guidance` | FFmpeg Project | não declarada | `citation-only` | unknown; [termos](<https://ffmpeg.org/legal.html>); acesso `2026-07-24T14:32:31Z`; Fonte oficial para capabilities de mix e sidechain. A licença do software não é presumida como licença da documentação; nenhum comando ou exemplo é copiado. | sem snapshot local |
| `itu-bs1770-5` | [Recommendation ITU\-R BS.1770\-5](<https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en>) | `external-standard` | International Telecommunication Union | `BS.1770-5` / `2023-11-22` | `factual-extraction-only` | known / ITU\-Copyright; [termos](<https://www.itu.int/en/Pages/copyright.aspx>); acesso `2026-07-24T14:32:31Z`; Fonte protegida usada apenas para identificar método de medição de loudness e true peak. Equações, tabelas e implementação não são copiadas. | sem snapshot local |
| `studio-governance-audio` | MKT Videos workspace audio governance (`urn:mkt-videos:governance:agents-md`) | `internal-policy` | MKT Videos | `Family distribution workspace policy 2026-09-09` | `normative-policy` | not\-applicable; acesso `2026-09-09T00:00:00Z`; Contrato local do projeto para narração via Google Vids, alinhamento Whisper local, trilha Flow Music cookie\-only, corte limpo e fade\-out apenas sob pedido explícito no modo Studio. | `ea179bfff41c24e294c8b9fdda2624c3ad5d2ac9ff09000530340f061ee13c42` |
| `w3c-wcag-captions` | [WCAG 2.2 Understanding Success Criterion 1.2.2: Captions \(Prerecorded\)](<https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded>) | `external-guidance` | World Wide Web Consortium | `WCAG 2.2 Understanding document` | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Documento informativo usado para a função de captions sobre fala e sons necessários à compreensão. Aplicação ao arquivo e canal deve ser definida no perfil de entrega. | sem snapshot local |
| `w3c-webvtt-2026` | [WebVTT: The Web Video Text Tracks Format](<https://www.w3.org/TR/2026/CRD-webvtt1-20260520/>) | `external-draft-specification` | World Wide Web Consortium | `Candidate Recommendation Draft 20 May 2026` / `2026-05-20` | `paraphrase-only` | known / W3C\-Document\-License\-2023; [termos](<https://www.w3.org/copyright/document-license-2023/>); acesso `2026-07-24T14:32:31Z`; Especificação em evolução usada para a noção de tracks textuais sincronizadas. O status de draft é preservado e nenhuma sintaxe é copiada. | sem snapshot local |

### Definições

- **Inteligibilidade** (`def-intelligibility`; base `editorial-synthesis`): Capacidade de compreender o conteúdo linguístico no contexto real de reprodução, considerando performance, ruído, espectro, dinâmica, mix, dispositivo e captions. Fontes: nenhum.
- **Ducking** (`def-ducking`; base `editorial-synthesis`): Redução controlada de uma camada, normalmente música ou ambiente, em resposta à prioridade temporal de outra, como voz ou evento essencial. Fontes: `ffmpeg-filters`.
- **Perfil de loudness** (`def-delivery-loudness`; base `editorial-synthesis`): Conjunto versionado de método de medição, alvo, tolerância, limite de pico e escopo de programa adotado por um destino específico. Fontes: `itu-bs1770-5`, `ebu-r128-v5`, `ebu-r128s1`.

### Princípios

#### `p-voice-performance` — Voz começa por intenção, interpretação e prosódia

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Antes de parâmetros técnicos, a voz deve declarar quem fala, para quem, com qual intenção, subtexto, ritmo, ênfases, pausas e pronúncias.
- Intenção: Fazer performance e significado precederem correções de mix.
- Fontes: nenhum.
- Aplicabilidade:
  - Narração, diálogo, locução comercial, entrevista e voz sintética autorizada.
  - Planejamento audio\-first e marcação de roteiro.
- Limites:
  - Prosódia apropriada depende de idioma, região, personagem e contexto.
  - Capacidade declarada de um TTS não garante interpretação satisfatória.
- Riscos:
  - Ênfase errada altera claim ou intenção.
  - Ritmo uniforme reduz compreensão mesmo com áudio limpo.
- Sinais de sucesso:
  - Palavras operacionais e mudanças de intenção são audíveis.
  - Pronúncias e pausas essenciais estão declaradas antes da geração ou gravação.
- Testes:
  - `t-performance-map` — cenário: Marcar intenção, palavra focal, pausa e mudança de energia em cada unidade de fala. Resultado esperado: A direção é específica o suficiente para gravação ou geração, mas não depende de imitar uma voz real.

#### `p-intelligibility-first` — Inteligibilidade da mensagem essencial tem prioridade no mix

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Voz e sons informativos devem permanecer compreensíveis nos dispositivos e ambientes alvo, sem depender de volume excessivo.
- Intenção: Preservar conteúdo antes de textura, impacto ou densidade.
- Fontes: nenhum.
- Aplicabilidade:
  - Peças com fala, instrução, claim, diálogo ou som narrativo essencial.
  - Mixes destinados a mobile, web, apresentação ou broadcast.
- Limites:
  - Inteligibilidade percebida exige teste humano no contexto alvo.
  - Medição de loudness não mede compreensão.
- Riscos:
  - Música e efeitos mascaram consoantes ou palavras críticas.
  - Compressão agressiva aumenta fadiga e ruído.
- Sinais de sucesso:
  - Conteúdo essencial é compreendido em reprodução representativa.
  - A redução de música durante a voz é suave e suficiente, não automática por hábito.
- Testes:
  - `t-target-playback` — cenário: Ouvir trechos de maior densidade em dispositivo e nível de reprodução representativos. Resultado esperado: Fala e sinais essenciais permanecem compreensíveis sem consultar o roteiro.

#### `p-rhythm-sync-silence` — Ritmo, sincronismo, silêncio e SFX formam uma gramática temporal

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Eventos sonoros podem antecipar, coincidir, prolongar ou contrastar eventos visuais; silêncio é uma decisão de densidade, não ausência de trabalho.
- Intenção: Usar tempo sonoro para orientação, impacto, continuidade e respiração.
- Fontes: nenhum.
- Aplicabilidade:
  - Transições, ações, motion graphics, montagem musical e narrativa.
  - Cues que precisam ser acessíveis por captions.
- Limites:
  - Sincronismo exato não é sempre mais expressivo.
  - Silêncio absoluto pode não existir no ambiente ou canal.
- Riscos:
  - SFX redundante transforma toda mudança visual em pontuação.
  - Evento sonoro antecipado cria causalidade não desejada.
- Sinais de sucesso:
  - Cada evento relevante tem relação temporal e função declaradas.
  - Pausas preservam tensão ou compreensão sem parecer falha técnica.
- Testes:
  - `t-cue-map` — cenário: Mapear início, pico e cauda de cues relevantes contra os eventos visuais. Resultado esperado: Alinhamentos e contrapontos são intencionais e não mascaram fala ou informação.

#### `p-music-theme-texture` — Música articula tema, textura e dinâmica sem narrar tudo

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Tema organiza identidade ou recorrência; textura define densidade e material; dinâmica distribui energia no tempo. Música pode apoiar, tensionar ou contradizer a imagem.
- Intenção: Escolher função musical antes de gênero, referência ou prompt.
- Fontes: nenhum.
- Aplicabilidade:
  - Trilha original, material licenciado e geração musical explicitamente autorizada.
  - Leitmotiv, bed, transição, montagem e encerramento.
- Limites:
  - Tema não exige melodia; pode ser timbre, pulso ou intervalo.
  - Ausência de música pode ser a escolha adequada.
- Riscos:
  - Referência nomeada vira pedido de imitação.
  - Crescimento musical promete clímax que a narrativa não entrega.
- Sinais de sucesso:
  - A função musical cabe em linguagem abstrata e não imitativa.
  - Mudanças de textura e dinâmica correspondem à estrutura da peça.
- Testes:
  - `t-music-function` — cenário: Descrever a função de cada entrada musical sem citar artista, faixa ou obra. Resultado esperado: A descrição usa propriedades e intenção; entradas sem função são opcionais, não obrigatórias.

#### `p-mix-hierarchy-ducking` — Hierarquia de mix governa dinâmica e ducking

- Base epistemológica: `editorial-synthesis`.
- Modalidade: `heuristic`.
- Definição: Cada trecho deve declarar camada prioritária e margens de convivência; ducking é uma das respostas possíveis quando camadas competem.
- Intenção: Manter voz, música, ambiente e efeitos em relação controlada sem achatar toda a dinâmica.
- Fontes: `ffmpeg-filters`.
- Aplicabilidade:
  - Mix multitrack, sidechain, automação de ganho e versões sem voz.
  - Trechos em que fala e música compartilham faixa de frequência.
- Limites:
  - Ducking não substitui arranjo, escolha de timbre ou edição.
  - Parâmetros dependem do material e não devem ser universais.
- Riscos:
  - Bombeamento audível distrai.
  - Prioridade fixa elimina contrastes narrativos.
- Sinais de sucesso:
  - A camada prioritária permanece clara e a secundária conserva função.
  - Transições de ganho não criam artefatos nem saltos não intencionais.
- Testes:
  - `t-priority-segments` — cenário: Dividir a timeline por mudanças de camada prioritária e revisar automação em cada fronteira. Resultado esperado: A hierarquia muda apenas quando a narrativa pede e o ducking não é aplicado onde edição ou arranjo resolveriam melhor.

#### `p-delivery-loudness` — Loudness e true peak pertencem ao perfil de entrega

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Medição deve usar método declarado e metas versionadas pelo destino; recomendações broadcast, short\-form e plataformas não são intercambiáveis por padrão.
- Intenção: Produzir entregas comparáveis e tecnicamente conformes sem transformar um número em regra universal.
- Fontes: `itu-bs1770-5`, `ebu-r128-v5`, `ebu-r128s1`, `ebu-tech3341`.
- Aplicabilidade:
  - Masters, broadcast, plataformas e versões com perfis diferentes.
  - QA técnico provider\-free de mix final.
- Limites:
  - Meta EBU é específica de fluxos que a adotam.
  - Medição válida não garante estética, inteligibilidade ou ausência de clipping em toda transcodificação.
- Riscos:
  - Normalizar para alvo errado altera dinâmica e compatibilidade.
  - Medir trecho quando o perfil exige programa completo produz conclusão inválida.
- Sinais de sucesso:
  - Recibo registra método, escopo, alvo, tolerância e limite de pico.
  - Valor medido é comparado somente ao perfil aplicável.
- Testes:
  - `t-profile-bound-measurement` — cenário: Executar medição técnica sobre o master com o perfil de entrega selecionado. Resultado esperado: Relatório contém valores e conformidade relativa ao perfil, sem escolher outro alvo automaticamente.

#### `p-clean-cut-no-fade` — O padrão do projeto é corte limpo, sem fade\-out

- Base epistemológica: `internal-policy`.
- Modalidade: `hard-constraint`.
- Definição: Trilha, narração e master encerram por corte limpo na duração da timeline; fade\-out só entra por pedido explícito e sua duração deve constar no recibo.
- Intenção: Preservar o contrato operacional e impedir acabamento não solicitado.
- Fontes: `studio-governance-audio`.
- Aplicabilidade:
  - Toda composição e entrega Studio deste workspace.
  - Narração, música, efeitos e master.
- Limites:
  - O usuário pode pedir fade\-out explicitamente.
  - Cauda natural dentro da timeline não é automaticamente um fade aplicado.
- Riscos:
  - Fade implícito altera intenção e duração percebida.
  - Corte fora de zero crossing pode produzir clique se o asset não foi preparado.
- Sinais de sucesso:
  - Nenhuma automação de fade existe sem parâmetro explícito.
  - Recibo distingue corte, cauda natural e fade solicitado.
- Testes:
  - `t-ending-policy` — cenário: Inspecionar plano e recibo para operações de ganho no encerramento. Resultado esperado: Sem pedido explícito, não há fade\-out; o áudio termina na duração da timeline por corte limpo tecnicamente válido.

#### `p-accessible-audio` — Acessibilidade traduz informação sonora essencial

- Base epistemológica: `source-grounded`.
- Modalidade: `hard-constraint`.
- Definição: Fala e sons necessários à compreensão devem ter representação textual sincronizada adequada ao canal, com identificação de falante e informação sonora quando relevantes.
- Intenção: Permitir compreensão quando o áudio não pode ser ouvido ou distinguido.
- Fontes: `w3c-wcag-captions`, `w3c-webvtt-2026`.
- Aplicabilidade:
  - Conteúdo pré\-gravado com fala ou sons narrativos.
  - Entregas com captions embutidas, sidecar ou track.
- Limites:
  - Formato e requisito de conformidade dependem do meio.
  - Transcrição literal pode exigir edição para sincronismo e identificação.
- Riscos:
  - Captions omitem som que muda o sentido.
  - Sincronismo ruim associa fala ao evento errado.
- Sinais de sucesso:
  - Conteúdo essencial permanece compreensível com áudio indisponível.
  - Captions respeitam ordem, duração e safe area do perfil.
- Testes:
  - `t-muted-comprehension` — cenário: Revisar a peça sem áudio usando a representação textual de entrega. Resultado esperado: Fala, identidade de falante e sons narrativos necessários continuam compreensíveis.

#### `p-provider-capability` — Limite de provedor é capability expirada, não convite a retry

- Base epistemológica: `internal-policy`.
- Modalidade: `capability`.
- Definição: TTS, música e outras funções externas só podem entrar quando capability cookie\-only está vigente, a etapa foi explicitamente autorizada e o gate de gasto foi confirmado.
- Intenção: Separar conhecimento de áudio de disponibilidade operacional e impedir repetição ambígua.
- Fontes: `studio-governance-audio`.
- Aplicabilidade:
  - Google Vids, Flow Music e futuros adapters de áudio governados.
  - Planejamento, runtime guard e retomada de estado.
- Limites:
  - O estado vigente em 2026\-07\-24 pode mudar após nova prova autorizada.
  - Teste local não comprova acesso live.
- Riscos:
  - Depender de capability não comprovada bloqueia entrega.
  - Retry após estado ambíguo pode duplicar consumo ou resultado.
- Sinais de sucesso:
  - Plano distingue etapa opcional, capability e fallback previamente aprovado.
  - Falha ou expiração bloqueia antes do POST e não repete automaticamente.
- Testes:
  - `t-capability-before-post` — cenário: Simular capability ausente ou expirada antes de etapa de TTS ou música. Resultado esperado: Runtime falha fechado, não chama provedor e não seleciona fallback silencioso.


### Exceções

- `x-explicit-fade` — princípios `p-clean-cut-no-fade`. Condição: O usuário pede explicitamente fade\-out e aprova sua duração. Resposta: Aplicar somente no modo Studio, preservar originais e registrar duração, curva, escopo e artefato resultante no recibo. Fontes: `studio-governance-audio`.

### Anti-padrões

- **Um número de loudness para todos os destinos** (`a-one-loudness-number`): Aplicar alvo broadcast a web, short\-form e apresentação sem perfil ou revalidação.
  - Princípios: `p-delivery-loudness`.
  - Riscos: Não conformidade e alteração desnecessária de dinâmica.; Relatórios tecnicamente corretos para o contexto errado..
  - Mitigações: Versionar perfil por destino.; Registrar método, escopo e tolerância junto ao resultado..
  - Fontes: `itu-bs1770-5`, `ebu-r128-v5`, `ebu-r128s1`.

### Exemplos abstratos

- **Mix guiado por prioridade temporal** (`e-audio-priority-map`): A fala abre em primeiro plano, a música reduz densidade durante a informação central, um SFX marca a virada e o master encerra por corte limpo conforme a timeline.
  - Análise: A solução descreve funções, não parâmetros universais. Valores de ganho e loudness dependem dos assets e do perfil de entrega.
  - Princípios: `p-intelligibility-first`, `p-rhythm-sync-silence`, `p-mix-hierarchy-ducking`, `p-clean-cut-no-fade`.
  - Fontes: `itu-bs1770-5`, `studio-governance-audio`.

### Contraexemplos

- **Trilha definida apenas por obra ou artista** (`c-music-by-reference-only`): O brief cita uma faixa conhecida, mas não descreve função, ritmo, textura, dinâmica, direitos ou relação com a narrativa.
  - Análise: A referência não é especificação suficiente e aumenta risco de imitação. A direção deve ser convertida em propriedades abstratas e direitos válidos antes de qualquer uso.
  - Princípios: `p-music-theme-texture`, `p-provider-capability`.
  - Fontes: `studio-governance-audio`.

### Cobertura governada

- Tags obrigatórias: `voice`, `performance-intent`, `prosody`, `intelligibility`, `rhythm`, `music`, `theme`, `texture`, `dynamics`, `silence`, `sound-effects`, `synchronization`, `ducking`, `loudness`, `clean-cut`, `no-default-fade`, `accessibility`, `provider-limitations`.
- Mapeamento tag → princípios:
  - `accessibility`: `p-accessible-audio`.
  - `clean-cut`: `p-clean-cut-no-fade`.
  - `ducking`: `p-mix-hierarchy-ducking`.
  - `dynamics`: `p-music-theme-texture`, `p-mix-hierarchy-ducking`.
  - `intelligibility`: `p-intelligibility-first`.
  - `loudness`: `p-delivery-loudness`.
  - `music`: `p-music-theme-texture`.
  - `no-default-fade`: `p-clean-cut-no-fade`.
  - `performance-intent`: `p-voice-performance`.
  - `prosody`: `p-voice-performance`.
  - `provider-limitations`: `p-provider-capability`.
  - `rhythm`: `p-rhythm-sync-silence`, `p-music-theme-texture`.
  - `silence`: `p-rhythm-sync-silence`.
  - `sound-effects`: `p-rhythm-sync-silence`.
  - `synchronization`: `p-rhythm-sync-silence`.
  - `texture`: `p-music-theme-texture`.
  - `theme`: `p-music-theme-texture`.
  - `voice`: `p-voice-performance`, `p-intelligibility-first`.

### Changelog

- Versão 1, `2026-07-24`: Candidato inicial com performance, inteligibilidade, ritmo, música, mix, loudness e acessibilidade.; Política de corte limpo e capabilities atuais do workspace foram separadas de recomendações técnicas externas..
- Versão 2, `2026-09-09`: Nova versão candidata para distribuição familiar: vínculo com a política sanitizada do workspace. Conteúdo técnico e termos preservados; nenhuma ativação ou promoção..

