---
impacto: capacidade_nova
secao: corrigido
titulo: CRM se recupera sozinho quando o pool do banco trava
---

O healthcheck agora consulta o banco e, após três falhas PGRST003 consecutivas, encerra o app para o Docker levantá-lo novamente. O limite de três reinícios por hora evita laço infinito; banco realmente fora mantém o processo de pé e deixa o bloqueio visível na rota de saúde.
