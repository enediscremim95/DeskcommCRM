---
impacto: capacidade_nova
secao: adicionado
titulo: Reprocessamento imediato das fotos de perfil do WhatsApp
---

O cron de fotos de perfil agora aceita `?force=true` com o mesmo Bearer interno. Use essa chamada apenas depois de corrigir ou trocar a conexão do WhatsApp: ela ignora os sete dias de espera local e solicita uma imagem nova ao WAHA, que normalmente mantém a resposta em cache por 24 horas.

O CRM também converte automaticamente a identidade interna `phone:+55...` ou `lid:...` para o identificador que o WAHA aceita antes de buscar a foto.
