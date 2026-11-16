# Formulário e WhatsApp: identidade e consolidação

Pedido de Enedi de 16/11/2026, para todas as organizações. Captação automática usa negócio aberto do mesmo contato/funil, sem prazo (lógica do PR #223); cadastro usa telefone BR normalizado e e-mail normalizado antes de inserir. Negócios intencionais e encerrados continuam separados.

A auditoria é somente leitura, com snapshot consistente de contatos ativos e negócios abertos. `scripts/ops/auditar-dedup.py snapshot.json plano.json` agrupa componentes de telefone/e-mail dentro de cada organização. Contagens são **candidatos**, pois dois pedidos legítimos da mesma pessoa também podem estar abertos. Nunca interpretar grupo como autorização para apagar.

Artefatos privados desta instalação: `/root/backups/dedup-20261116/`. Contém pg_dump completo validado por pg_restore --list, snapshot de identidades, plano por org e script manual de consolidação. Nenhum dado pessoal vai para o git. O script é fora das migrations, não entra em install/update/deploy. Arquivo `pares-revisados.sql` começa vazio; `pares-candidatos.sql` é material para revisão humana.

Antes de aplicar: obter o aceite do Enedi para os pares e sobreviventes específicos, parar consumidores durante a janela, fazer novo backup completo e validar a restauração em clone. Copiar somente pares aprovados para `pares-revisados.sql`. Rodar primeiro sem `confirmado` (rollback), medir timelines/mensagens, revisar snapshots e conflitos; só depois usar `-v confirmado=sim`. Não executar nesta tarefa em produção.

Contatos usam `fn_mesclar_contatos` (0215, incluindo hardening posterior); abortar se o retorno indicar referências não repontadas. Cards: sobrevivente mantém etapa/status/responsável/valor; campos, tags, descrição e todas as referências FK simples são reunidos, originais completos ficam no schema restrito `veritas_dedup.snapshots`, inclusive conflitos e referências anteriores. FK composta ou colisão aborta a transação inteira. IDs de cards absorvidos deixam de existir após aplicação: recuperar exige snapshot/restauração controlada. Não confundir rollback da aplicação com rollback do banco. O script de consolidação nunca deve rodar sem o backup.

Ensaio de dados não executa consumidores, WhatsApp, e-mail nem IA. Uma instalação distribuída não incorpora dados ou IDs desta VPS.
