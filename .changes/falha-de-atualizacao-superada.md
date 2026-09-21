---
impacto: nada_mudou
secao: corrigido
titulo: A tela de atualização não manda voltar versão depois que a falha já foi superada
---

Uma tentativa antiga que falhou continua disponível nos detalhes para diagnóstico, mas deixa de aparecer como se o sistema ainda pudesse estar fora do ar e não sugere downgrade quando o servidor já confirmou uma versão posterior. O atualizador também recusa começar enquanto outro `docker compose` estiver recriando a mesma instalação e, se detectar a colisão durante a execução, não inicia um rollback concorrente.
