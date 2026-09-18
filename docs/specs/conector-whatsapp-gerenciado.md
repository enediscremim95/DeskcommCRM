# Conector WhatsApp gerenciado

Status: CONFIRMADO nesta implementação.

## Objetivo

Uma organização pode apontar o CRM para uma instância Evolution API já existente. O CRM observa o estado e permite solicitar o QR da mesma instância pela tela `Canais > Conexões`. Mensagens continuam fora deste conector e, no caso do n8n, continuam sob responsabilidade do fluxo que já possui o webhook da instância.

## Invariantes

1. Uma organização com conector Evolution ativo não pode abrir nem reativar sessão WAHA. A aplicação verifica antes do efeito externo e o banco repete a trava por trigger. A unicidade existente de `(organization_id, phone_number)` impede o mesmo número em dois providers.
2. O CRM nunca configura webhook na Evolution. Não existe chamada de escrita de webhook neste fluxo.
3. O CRM nunca cria, apaga ou recria instância. As únicas chamadas permitidas são `GET /instance/connectionState/{instancia}` e, após clique humano, `GET /instance/connect/{instancia}`.
4. A chave da instância entra por formulário write-only do admin da plataforma, é cifrada no backend por `fn_encrypt_oauth` e nunca volta nas respostas da API.
5. O QR só é solicitado por clique. O banco permite uma tentativa por minuto e no máximo três tentativas até uma transição confirmada para `open`. O estado `open` zera o contador para uma queda futura.
6. A URL de hook opcional é chamada uma vez na transição atômica de estado diferente de `open` para `open`. Falha fica visível na tela e no audit log, sem desfazer a reconexão.

## Superfícies

- Admin da plataforma: `/admin/tenants/{id}/whatsapp`.
- Configuração: `GET|PUT /api/v1/admin/tenants/{id}/managed-channel`.
- Organização: `GET /api/v1/channel-sessions/managed`.
- Estado: `POST /api/v1/channel-sessions/managed/state`.
- QR: `POST /api/v1/channel-sessions/managed/qr`.

Todas as chamadas ao serviço externo partem do backend, recusam redirect e passam pelas guardas de URL e resolução DNS contra SSRF. A Evolution é classificada como provider conhecido sem transporte de mensagens, pois a ingestão e o envio do n8n não fazem parte deste escopo.

## Códigos observáveis

- `channel_connector_conflict`: tentativa de abrir WAHA numa organização que usa o conector gerenciado.
- `managed_connector_waha_conflict`: tentativa administrativa de configurar o conector enquanto há WAHA ativo.
- `managed_connector_qr_rate_limited`: nova tentativa antes de um minuto.
- `managed_connector_qr_attempts_exhausted`: três tentativas já consumidas sem confirmação de `open`.

## Laço de retorno

Queda detectada gera estado `STOPPED` e aviso na tela. A pessoa solicita o QR, a tela consulta o estado a cada cinco segundos durante a validade do código e, ao confirmar `open`, o banco publica `WORKING`, zera o contador, registra audit e dispara o hook opcional. Se o hook falhar, o erro permanece visível e auditado para ação humana.
