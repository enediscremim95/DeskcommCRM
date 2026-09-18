---
impacto: exige_acao
secao: adicionado
titulo: Integrações agora são liberadas separadamente para cada organização
---

O administrador da instalação ganhou uma aba única para decidir se o cliente
pode ver WhatsApp, n8n e o relatório de mídia. Sem liberação, o item não aparece
no menu e o acesso direto também é recusado. A geração de QR tem uma permissão
separada, porque ver o estado da conexão não autoriza reconectar o número.

Os workflows do n8n são vinculados à organização no CRM e aparecem ao cliente
somente para consulta, com desenho do fluxo e últimas execuções. Credenciais,
parâmetros, código e dados processados não saem do servidor.

## Requer atenção

Para usar a integração com n8n, o operador precisa definir `N8N_BASE_URL` e
`N8N_API_KEY` no `.env` depois da atualização e recriar o contêiner do app. Em
seguida, abre a organização no painel administrativo, entra em Integrações,
atribui os workflows e libera o que o cliente poderá ver.
