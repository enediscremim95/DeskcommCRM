---
impacto: exige_acao
secao: adicionado
titulo: O dono recebe no WhatsApp quando o CRM cai e quando volta
---
A instalação ganha uma vigia independente do app e do banco, com confirmação contra soluços, diagnóstico por componente, watchdog próprio e alerta antecipado da mídia. Para receber, informe `VIGIA_WHATSAPP_TO`; os binários ficam 21 dias, avisam em 2,37 GB e param de entrar em 3,15 GB sem apagar a mensagem.

## Requer atenção

Defina `VIGIA_WHATSAPP_TO` no `.env` da instalação com DDI e DDD e execute a atualização normalmente. Sem esse valor, a vigia continua medindo e registrando heartbeat, mas não tem destinatário para os avisos.
