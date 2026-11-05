---
impacto: correcao
secao: corrigido
titulo: Mensagem recebida não fica sem turno quando a configuração do agente muda
---

Se a versão, a revisão, o modo ou a pausa do agente mudarem enquanto ele prepara uma resposta, o mesmo turno volta para a fila e recomeça com a configuração atual. Antes, essa mudança era confundida com troca de atendimento e descartava definitivamente o turno, inclusive quando ele carregava a mensagem mais nova da cliente.
