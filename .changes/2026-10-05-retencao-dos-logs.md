---
impacto: nada_mudou
secao: corrigido
titulo: Logs antigos passam a ser limpos sozinhos
---

O banco passa a remover, em lotes pequenos, arquivos de webhook já sem corpo e eventos internos concluídos que ultrapassaram a retenção configurada. Trabalho pendente ou em processamento continua intocado, e rodadas sem efeito não aumentam a própria auditoria.
