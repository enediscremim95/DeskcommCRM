---
impacto: nada_mudou
secao: corrigido
titulo: Quem é convidado entra na empresa ao confirmar o e-mail, sem mais um clique
---

Confirmar o e-mail vindo de um convite passa a **criar o vínculo** e abrir o CRM já dentro da empresa. Antes, a confirmação levava a uma tela com um botão "Aceitar convite" — e quem não o apertava terminava autenticado, sem organização e sem menu, num CRM vazio.

Três consertos, todos no ciclo de vida do vínculo:

- **O convite é aceito na própria confirmação.** A rota já sabia tudo o que o botão exigia, e com garantia mais forte: o e-mail do convite é comparado com o que o provedor de autenticação acabou de confirmar. Se o vínculo falhar (convite revogado, banco fora), a tela de aceite continua existindo e recebe a pessoa — nada fica sem saída.
- **Clicar duas vezes no link do e-mail não desloga mais ninguém.** O token é de uso único: o segundo clique falhava e mandava para a tela de login **quem já estava logado pelo primeiro**, com o cookie de sessão intacto. A pessoa reentrava pela senha e perdia o fio do convite. Agora a rota reconhece a sessão que já existe e segue.
- **Acesso revogado deixa de virar convite para abrir empresa.** Quem tinha o vínculo retirado caía numa tela vazia oferecendo "Configure sua organização" — uma revogação virando criação de tenant. Agora vê uma tela que nomeia o que aconteceu, e a ação de recuperação recusa com o motivo certo, em vez da mensagem sobre convite pendente que aparecia por acaso.

Nada muda na configuração: não há variável nova, passo de atualização nem mudança de schema.

Achado instalando numa VPS com Supabase self-hosted, com dois convidados reais que não conseguiram entrar.
