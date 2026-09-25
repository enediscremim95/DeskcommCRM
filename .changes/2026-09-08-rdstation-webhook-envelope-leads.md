---
impacto: capacidade_nova
secao: corrigido
titulo: Webhook de captação agora reconhece o formato de lead do RD Station
---

Ao apontar um webhook do RD Station para uma fonte de captação de leads, os envios reais não viravam lead: o RD Station empacota os dados dentro de uma lista (`leads: [...]`), e o leitor de campos do webhook só olhava o nível de cima, então nome, e-mail e telefone chegavam "em branco" e a captação era recusada.
