# Áudio, música e sincronia

No Studio, use Google Vids para narração externa, Flow Music para música e
Whisper local para alinhamento. Não substituir por Gemini TTS direto ou Lyria
Realtime. Áudio só entra quando solicitado; o render Three.js é visual silencioso.

Para music-first, dimensione a fala pela duração útil da música e reserve o
arremate musical. A cadência de 2,4–2,6 palavras por segundo serve como estimativa
inicial, mas a montagem usa a duração e as palavras efetivamente medidas.

Extraia timestamps por palavra com Whisper. A timeline visual deve consultar o
tempo absoluto; textos, destaques, entradas de imagem e efeitos sonoros usam os
mesmos eventos. Som aplicado somente na montagem deve existir como arquivo real.

Para clips Omni com texto gráfico e narração separada, rotule palavras como
elementos gráficos silenciosos, nunca como roteiro de fala. Peça explicitamente
zero vozes, fala, canto ou sussurros na camada visual. Use SFX sincronizados com
movimentos e revelações; escolha intensidade conforme a direção solicitada.

Som premium discreto usa poucos eventos, ataques suaves e ganho baixo. Reserve
impactos para mudanças relevantes; não sonorize cada detalhe. Three.js fornece
recursos de áudio para reprodução, mas a exportação do Studio precisa materializar
e mixar as faixas no pipeline, não depender do som ouvido no navegador.

Não aplique ganhos fixos sem medir os arquivos. Priorize inteligibilidade,
ausência de clipping e equilíbrio voz/música/SFX. Preserve o original do provedor
e registre cortes, ganhos e mixagem. Não use fade-out automático.

Consulte a ajuda de `audio-recipe`, `music`, `mix` e `captions` antes de executá-los.
Prepare explicitamente o runtime/modelo Whisper; não copie ambiente Python ou
cache de outro usuário nem consuma geração externa para testar instalação local.
