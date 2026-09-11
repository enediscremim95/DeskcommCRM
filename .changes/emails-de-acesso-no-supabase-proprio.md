---
impacto: capacidade_nova
secao: adicionado
titulo: Os e-mails de acesso passam a funcionar (e a ter marca) num Supabase próprio
---

Quem roda **Supabase self-hosted** ganha o que só existia na nuvem: e-mail de confirmação de conta e de redefinição de senha com a marca da instalação, e — o que importa mais — com o link que **fecha a sessão**.

O app passa a servir os dois moldes em `/email-templates/confirmation` e `/email-templates/recovery`. Aponte o GoTrue para eles:

```bash
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://SEU_DOMINIO/email-templates/confirmation
GOTRUE_MAILER_TEMPLATES_RECOVERY=https://SEU_DOMINIO/email-templates/recovery
GOTRUE_MAILER_SUBJECTS_CONFIRMATION="Confirme seu e-mail · SUA MARCA"
GOTRUE_MAILER_SUBJECTS_RECOVERY="Redefinir sua senha · SUA MARCA"
```

**Nada muda para quem não apontar**, e nada muda na nuvem do Supabase — lá o caminho continua sendo o `marca-emails.sh` pela Management API.

**O kit ensina e confere, mas não escreve — e o motivo é honesto.** O GoTrue não é serviço deste compose: o kit sobe `app`, `worker`, `scheduler`, `waha`, `redis`, `srh` e `caddy`, e o Supabase próprio é outra stack, que pode nem estar na mesma máquina. Escrever nela seria o instalador editar instalação de terceiro. Então o `install.sh` passa a imprimir as quatro linhas exatas quando a topologia é própria (antes ele mandava o self-hoster para `supabase.com/dashboard`, que ele não tem), e `bash hostgator-setup-kit/healthcheck.sh` ganhou uma seção que **mede o estado**: se o app serve o molde, se algum GoTrue desta máquina aponta para ele, e se o valor configurado é URL — acusando em vermelho o caminho de arquivo que falha calado.

**Por que isso conserta e não só embeleza.** O modelo padrão do GoTrue linka para `/auth/v1/verify`, que devolve um `code` PKCE. O verificador desse code vive num cookie `SameSite=Strict`, e clique vindo de webmail é navegação cross-site: o cookie não viaja e a sessão nunca fecha. A conta é confirmada, a pessoa entra pela senha, e fica sem organização e sem menu. Os moldes do app linkam com `token_hash`, que não depende de cookie nenhum.

**A marca passa a seguir o banco.** O `marca-emails.sh` lê o `.env`, então trocar nome ou cor em **Configurações › Marca** não reescrevia os e-mails de acesso. Servindo pelo app, a marca é resolvida a cada busca e o GoTrue re-busca sozinho a cada 10 minutos (`GOTRUE_MAILER_TEMPLATE_MAX_AGE`) — sem reiniciar nada e sem rodar script.

**Se você seguiu a receita antiga, troque as variáveis.** Até esta versão, `docs/deploy-selfhost/README.md` e o `marca-emails.sh` mandavam apontar `GOTRUE_MAILER_TEMPLATES_*` para um **caminho de arquivo**. Isso não funciona e falha calado: o GoTrue cola o que não começa com `http` no fim do `SITE_URL` e faz um GET, então ele busca `https://SEU_DOMINIO/opt/.../confirmation.html`, recebe o HTML da tela de login e manda **isso** para a caixa de entrada do cliente. Medido em 2026-09-09; o Gmail marcou como phishing.

Achado instalando numa VPS com Supabase próprio, seguindo a documentação do produto do começo ao fim.
