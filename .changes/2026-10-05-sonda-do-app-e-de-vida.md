---
impacto: nada_mudou
secao: corrigido
titulo: Lentidão do banco não tira mais o CRM inteiro do ar
---

O Docker agora mede somente se o app está vivo e aceitando conexão. Supabase lento continua visível na rota de saúde e na vigia, mas não faz o Traefik retirar login, telas e webhooks do roteamento público.
