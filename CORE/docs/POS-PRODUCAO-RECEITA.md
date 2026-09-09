# Pós-produção ordenada da Receita Mestre

`postProduction.operations` compila para nós `post:<id>` no DAG existente. O fluxo é montagem/mixagem/legendas → operações na ordem declarada → QA → acabamento/entrega. Cada operação usa CPU local, mantém entrada imutável e publica arquivo e recibo próprios. Não há alteração do modo raw nem um segundo executor.

| Operação | Efeito material e limite |
| --- | --- |
| `color-normalize@1` | Saída SDR BT.709, faixa limitada e yuv420p. Fonte sem primárias declaradas registra a interpretação SDR BT.709 no recibo. HDR ou outras primárias/transferências declaradas são recusados; não há tonemapping implícito. |
| `logo-overlay@1` | Logo estático durante a timeline inteira, preservando proporção, limitado a 20% da largura e 15% da altura, com margem direita/inferior de 5%. Exige asset image/logo governado, contexto local e direitos vigentes, além de hashes/bytes/MIME conferidos. |
| `ending-hold@1` | Congela o primeiro frame da região final declarada até o fim da timeline existente. Em 72 frames com hold de 24, mantém o frame de índice 48 até o 71. Não acrescenta duração nem congela o áudio. |

O áudio atravessa as operações por stream-copy, sem fade. Frames, fps, duração, presença de áudio e hashes são verificados antes/depois. Direitos do logo são relidos antes da geração, no uso e na retomada. Revogação bloqueia a continuidade; o registro da aprovação antiga não concede acesso atual.

O journal conserva os nós concluídos. Uma interrupção permite retomar a operação pendente sem repetir as anteriores. Publicação parcial só é recuperada mediante conferência de entradas, parâmetros, parentes e artefato pelo mecanismo local existente; originais não são sobrescritos.

Planos antigos com lista vazia continuam compatíveis com a fachada sem esse campo. Uma lista não vazia deve coincidir com o plano canônico e seus nós: não se acrescentam efeitos silenciosamente a um journal antigo.

A verificação destas operações deve usar FFmpeg real e providers simulados:
metadados de cor, pixels do logo sintético, últimos frames estáticos, igualdade
do PCM decodificado, originais preservados, recuperação de publicação, revogação
e retomada. Confira os testes correspondentes no código da sua versão; este
documento não substitui a execução nem um relatório de entrega.
