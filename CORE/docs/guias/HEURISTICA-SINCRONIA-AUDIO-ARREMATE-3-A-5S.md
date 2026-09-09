# 🎙️ Heurística de Sincronia de Áudio com Arremate Musical de 3 a 5 Segundos
> **Zero-Cut Audio-First Architecture / Calibragem Ativa de Palavras**  
> **Classificação:** Técnica de Áudio Canônica do Studio Audiovisual  
> **Status:** Técnica validada em cinco spots medidos  
> **Objetivo:** Casar perfeitamente locução neural e trilha sonora original sem cortes na fala, sem cortes na música e sem fade-out artificial, garantindo que o fechamento musical ocorra exatamente entre 3,0 e 5,0 segundos após a última palavra.

---

## 1. O Problema Fundamental da Produção de Áudio com IA

Na geração de áudio moderno para spots comerciais e publicidade:
1. **A Trilha Sonora (Flow Music)** é composta como uma obra musical inteira com introdução, desenvolvimento e um **acorde / batida de encerramento acústico natural** (*stinger / final resolve*).
2. **A Locução Neural (Google Vids)** leva o tempo fisiológico da fala humana para pronunciar cada palavra.
3. **O Dilema de Mixagem:**
   - ❌ **Cortar a música no meio** destrói a harmonia e soa como rádio desligado na tomada.
   - ❌ **Deixar a música sobrando por 20 a 40 segundos** cria um vazio pós-locução inaceitável.
   - ❌ **Aplicar fade-out artificial** enfraquece o impacto comercial e viola a diretriz de áudio limpo do estúdio.
   - ❌ **Acelerar a voz artificialmente** prejudica a inteligibilidade e a naturalidade da locução.

---

## 2. A Regra de Ouro do Arremate Musical (3,0s a 5,0s)

A sincronia ideal é definida pela **Janela Canônica de Arremate Acústico**:

$$\Delta = D_{\text{trilha}} - D_{\text{voz}}$$
$$\mathbf{3,0\,s \le \Delta \le 5,0\,s}$$

Onde:
* $D_{\text{trilha}}$: Duração física total da trilha sonora gerada (100% preservada).
* $D_{\text{voz}}$: Duração física total da locução sintetizada.
* $\Delta$: Folga de arremate musical, com **ponto central ideal de 4,0 segundos**.

```text
0s ────────────────────────────────────────── D_voz ─────────────── D_trilha
[          LOCUÇÃO INTEGRAL DA PROPAGANDA        ] (encerra aqui)
[ TRILHA COM DUCKING (-7dB a -10dB SOB A VOZ)    ] ──► [ ARREMATE MUSICAL (+8dB a +10dB) ]
                                                       ▲
                                            (3,0s a 5,0s de Clímax / Acorde Final)
```

---

## 3. Fórmula Matemática de Dimensionamento do Roteiro

Para que a locução termine exatamente dentro da janela de 3 a 5 segundos antes do fim da música, o número exato de palavras do roteiro é calculado a partir da cadência empírica medida de cada voz:

$$N_{\text{palavras}} = \text{round}\Big(\big(D_{\text{trilha}} - 4,0\,\text{s}\big) \times \text{Cadência}_{\text{voz}}\Big)$$

### Tabela de Cadências Empíricas Medidas (Google Vids):

| Voz | Perfil de Locução | Cadência Média | Tempo Médio por Palavra |
| :--- | :--- | :--- | :--- |
| **`Jett`** | Varejo, autoridade, grave, alta energia | **2,55 a 2,65 pal/s** | ~0,380 s/palavra |
| **`Kero`** | Jovem, vibrante, trap-pop, dinâmico | **2,45 a 2,55 pal/s** | ~0,400 s/palavra |
| **`Persuasiva`** | Corporativo, institucional, elegante | **2,05 a 2,15 pal/s** | ~0,480 s/palavra |
| **`Zeno`** | Teaser, cinematográfico, épico, pausado | **1,85 a 1,95 pal/s** | ~0,530 s/palavra |

---

## 4. Algoritmo de Calibragem Ativa em Malha Fechada

Quando um roteiro precisa ser ajustado a uma trilha já gerada:

1. **Medição da Trilha:** Mede-se $D_{\text{trilha}}$ via `ffprobe` (ex: $28,01\,\text{s}$).
2. **Cálculo da Meta:** Define-se $D_{\text{voz\_target}} = D_{\text{trilha}} - 4,0\,\text{s}$ (ex: $24,01\,\text{s}$).
3. **Geração do Roteiro:** Redige-se o roteiro com $N_{\text{palavras}} = D_{\text{voz\_target}} \times \text{Cadência}$.
4. **Sintetização e Medição:** Sintetiza-se a voz no Google Vids e afere-se $D_{\text{voz\_real}}$.
5. **Verificação de Conformidade:**
   - Se $3,0\,\text{s} \le (D_{\text{trilha}} - D_{\text{voz\_real}}) \le 5,0\,\text{s}$ $\rightarrow$ **Aprovado para Mixagem Master.**
   - Se $\Delta > 5,0\,\text{s}$ (fala muito curta): adiciona-se $\text{round}((\Delta - 4,0) \times \text{Cadência})$ palavras.
   - Se $\Delta < 3,0\,\text{s}$ (fala muito longa): remove-se $\text{round}((4,0 - \Delta) \times \text{Cadência})$ palavras.

---

## 5. Estrutura de Mixagem Master (Sidechain Ducking)

A mixagem master é executada via FFmpeg com preservação integral de 100% da trilha (`preserveMusicEnd: true`):

```bash
# Graph de Mixagem Padrão
[0:a]aresample=48000,volume=1.5849,apad=whole_dur=D_trilha[voice];
[1:a]aresample=48000,volume=2.5119[music];
[music][voice]sidechaincompress=threshold=0.08:ratio=7:attack=20:release=350[ducked];
[voice][ducked]amix=inputs=2:duration=longest:normalize=0[mix];
[mix]afade=t=in:st=0:d=0.2,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=duration=D_trilha,asetpts=N/SR/TB[master]
```

* **Ducking Dinâmico:** Enquanto o locutor fala, a música tem compressão suave (*threshold: 0.08, ratio: 7:1*).
* **Liberação Instantânea:** No exato momento em que a voz cessa, o compressor libera em 350 ms (*release: 350*), e a música sobe automaticamente para volume pleno (+8 dB a +10 dB).
* **Fechamento Acústico Natural:** A música desenvolve seu clímax e finaliza com o acorde resolvido original da composição do Flow Music.

---

## 6. Validação Empírica: A Suíte dos 5 Comerciais de Ouro

| # | Spot | Estilo / Gênero | Voz | Duração Voz | Duração Trilha | Arremate Final ($\Delta$) | Status da Regra |
|---|---|---|---|---|---|---|---|
| **1** | **Varejo Alto Impacto** | Eletrônico Comercial | *Jett* | 24,44s | 28,01s | **3,57s** | ✅ **3 a 5s** |
| **2** | **Trap-Pop Dinâmico** | Trap-Pop Urbano | *Kero* | 27,16s | 30,53s | **3,37s** | ✅ **3 a 5s** |
| **3** | **Oferta Relâmpago** | Ticking / Suspense | *Jett* | 50,60s | 54,63s | **4,03s** | ✅ **3 a 5s** |
| **4** | **Institucional Premium** | Orquestral / Piano | *Jett* | 50,68s | 55,34s | **4,66s** | ✅ **3 a 5s** |
| **5** | **Teaser Cinematográfico** | Trailer Blockbuster | *Zeno* | 49,10s | 53,74s | **4,64s** | ✅ **3 a 5s** |

---

## 7. Como Invocá-la no CLI

Para gerar novos spots utilizando automaticamente essa heurística:

```powershell
npm run video -- audio-recipe --mode studio --preset propaganda-varejo --strategy music-first --text "Seu roteiro calibrado..." --collection meu-spot-perfeito
```
