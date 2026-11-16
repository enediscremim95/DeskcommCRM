---
impacto: capacidade_nova
secao: corrigido
titulo: Sessão preservada quando a autenticação fica temporariamente indisponível
---
Falhas de rede, timeout e respostas 504 da autenticação passam a tentar novamente com pausas curtas. Se o serviço continuar indisponível, a sessão é preservada e as APIs respondem 503, permitindo tentar novamente sem refazer o login.
