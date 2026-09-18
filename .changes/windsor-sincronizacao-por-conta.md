---
impacto: capacidade_nova
secao: corrigido
titulo: O dashboard de tráfego conclui a sincronização sem travar no lote global
---
A sincronização do dashboard Windsor agora consulta cada conta no conector correto, com concorrência e prazo limitados, preservando o último conjunto confirmado quando uma conta falha.
