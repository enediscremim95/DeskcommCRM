# Credencial de IA padrão da organização

A página Chaves de acesso à IA consulta o catálogo de modelos disponíveis para
a chave própria. Uma chave cadastrada nessa tela pode ser validada e só entra
no chat por seleção explícita. Donos e administradores escolhem um modelo e confirmam o
impacto da troca. A rota de credenciais pede à mesma função SQL tanto a prévia
quanto a aplicação. A revisão da prévia protege contra mudanças concorrentes.

A função `fn_usar_credencial_ia_padrao` recebe o tenant e o ator autenticados
pela rota. Publica novas versões por `fn_publish_ai_agent_version`, troca os
vínculos de texto elegíveis e atualiza `organizations.settings.llm` na mesma
transação. Os resolvedores de IA consomem as versões publicadas, os vínculos e o
ponteiro padrão. A trilha `ai.default_credential_changed` chega à Auditoria
pelo `api_audit_log` e ao registro de eventos pelo `event_log`.

Se o canal de um agente estiver desconectado, a publicação recusa a troca
inteira. O responsável recebe a mensagem no diálogo e pode reconectar o canal
e rever a prévia. Um conflito de edição também pede uma nova prévia. A troca
tem efeito nas próximas execuções. O modo de operação do agente é guardado no
registro do agente e a transação usa a função oficial de publicação para
atualizar somente o ponteiro da versão publicada.

Com `settings.llm.sem_fallback_compartilhado = true`, os resolvedores de chat
exigem uma credencial própria e utilizável do fornecedor escolhido. Uma recusa
emite `llm_own_credential_required` no log estruturado antes da chamada. O
painel de Provedores mostra a política e sinaliza pontos sem uma credencial
própria válida. A verificação de uso real da chave continua no runtime, onde
ela pode ser decifrada e comparada às chaves da instalação. Usuários podem
corrigir a configuração em Chaves de acesso à IA e voltar ao painel para
acompanhar o estado.
