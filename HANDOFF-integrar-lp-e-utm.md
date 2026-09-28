# HANDOFF: a tela de Webhooks vira "integre seu site", com UTM que se explica sozinha

## O que a medição mostrou (produção, 25/09/2026)
Organização `sublimando`, que é o caso mais bem montado que temos:
- **uma** fonte de captação ("Formulário do site") para **quatro** páginas diferentes;
- 1.631 negócios com `source = webhook` e `source_metadata` contendo **apenas**
  `{"webhook_source_id": "..."}`: nenhuma UTM, nenhuma página, nenhuma campanha;
- `field_map` vazio.

Resultado prático: dentro do CRM não dá para responder "qual página trouxe este cliente", que é a
primeira pergunta de quem paga tráfego.

E o produto **já sabe fazer isso**: `lib/webhooks/snippet-da-lp.ts` captura sozinho todo parâmetro
`utm_*` da URL (linha 69), a rota inbound grava em `source_metadata`, e `RuleEditor` já filtra por
`lead.source_metadata.utm_source`. O que falta não é mecanismo, é a tela **ensinar o padrão** e
tornar o caminho errado difícil.

## O que construir

### 1. A tela de Webhooks passa a chamar as coisas pelo nome de quem usa
Título e texto de "integre seu site ao CRM". Primeiro parágrafo em duas linhas: cada página ou
oferta ganha a sua entrada, e o CRM passa a saber de onde veio cada pessoa.

### 2. Assistente de criação de fonte, em vez de formulário cru
Ao criar, perguntar em português: **qual página** (nome que a pessoa reconhece, ex.: "Dia dos
Professores"), **qual funil e etapa** o lead entra, e **quem responde**. Ao final, entregar:
- o script pronto **com o nome da página já dentro** (um campo `pagina` ou `origem` no envio,
  além das UTMs que o script já captura sozinho);
- o endereço da entrada;
- um botão **"Testar agora"** que dispara um lead de teste e mostra onde ele caiu.

**Uma fonte por página é o padrão sugerido pela tela**, com uma frase dizendo por quê: fonte única
para várias páginas é o que apaga a origem.

### 3. Bloco "Como marcar seus links" (UTM), curto e copiável
Com o padrão da casa, exemplo pronto e botão de copiar:

```
?utm_source=meta&utm_medium=cpc&utm_campaign=professores-2026&utm_content=video-01&utm_term=topo
```

Explicando cada um em uma linha, sem jargão: **source** é onde o anúncio rodou (meta, google,
instagram-bio), **medium** é o tipo (cpc, organico, email, whatsapp), **campaign** é a oferta com
ano (professores-2026), **content** é o criativo (video-01), **term** é o recorte (topo, remarketing).
Avisar o que quebra relatório: letra maiúscula, acento, espaço e nome diferente a cada campanha.
Tudo minúsculo, sem acento, com hífen.

### 4. A tela mostra o que está chegando, por origem
Na fonte, uma tabela dos últimos 30 dias: quantos leads por `utm_source`, por `utm_campaign` e por
página, e **quantos chegaram sem marcação nenhuma**. Esse último número é o que faz a pessoa
arrumar os links: hoje ninguém descobre que perdeu a origem.

### 5. Aviso de entrada muda
Quando uma fonte que vinha recebendo passa **48 horas sem nenhum lead**, abrir aviso na Central.
O caso real que motiva: as páginas da `sublimando` continuaram mandando lead para o sistema antigo
depois da migração, e **354 leads em três dias** não entraram no CRM. Ninguém percebeu pela tela,
perceberam contando à mão. Silêncio de uma entrada que era ativa é defeito, não calmaria.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- O script entregue continua funcionando em página estática simples (sem framework, sem npm).
- Nada de UTM inventada pelo CRM: se a página não mandou, a tela diz "sem marcação", não chuta.
- Testes que provam: fonte criada pelo assistente nasce com a página no envio; o resumo por origem
  conta certo, inclusive os sem marcação; e o aviso de entrada muda dispara depois da janela.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**.
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
