# HANDOFF (parte 3): quem usa o relatório escolhe as próprias colunas

## O que está errado hoje, medido
`app/api/v1/reports/traffic/route.ts:405` liga `can_manage_defaults` **só para admin de
plataforma**. O menu "Colunas" (`ColumnPresetMenu.tsx`) usa essa mesma chave para TUDO, então o
cliente não escolhe nem para si: ele só pode trocar entre predefinições que alguém criou antes.
E numa organização sem predefinição nenhuma (medido na `sublimando`: zero), o menu abre dizendo
"Nenhuma predefinição foi liberada" e não oferece nada. O dono viu isso na conta da esposa.

## A separação que resolve
Hoje uma permissão só governa duas coisas diferentes. Separe:

1. **Escolher as colunas PARA MIM** (nova capacidade, para **todo mundo** que abre o relatório,
   inclusive o cliente): lista das métricas disponíveis com caixinha, marcar e desmarcar, e a
   ordem em que aparecem se isso já existir na predefinição. A escolha vale para aquela pessoa,
   por organização e por plataforma, e volta igual na próxima visita. Preferir `localStorage`,
   como as larguras de coluna da parte 1, para não exigir migration.
2. **Definir o padrão da organização e criar, renomear ou excluir predefinição** continua
   **só para quem administra a plataforma**, exatamente como é hoje. O cliente não muda o que os
   outros veem.

Regras de conteúdo:
- **Nenhuma métrica fica escondida por papel.** Decisão do dono em 24/09/2026: "todo mundo pode
  ter acesso às colunas, não precisa limitar, cada usuário escolhe as métricas que quiser". A lista
  oferecida é a lista COMPLETA de métricas que aquela plataforma suporta
  (`campaignMetricColumnsForPlatform`), igual para cliente, atendente, gerente e administrador.
  A única exclusão permitida é técnica: métrica que a plataforma não tem (uma coluna só do Meta
  não aparece na tabela do Google).
- **Não depende de predefinição.** Organização sem predefinição nenhuma continua deixando cada
  pessoa montar a tela dela.
- Um botão **"Voltar ao padrão"** devolve a pessoa à predefinição padrão da organização e apaga a
  escolha pessoal.
- Quando a pessoa está com escolha própria, o menu diz isso em uma frase curta, para ela entender
  por que a tela dela difere da de um colega.
- A contagem no botão ("Colunas (7)") passa a refletir o que a pessoa está vendo de fato.
- Mensagem vazia atual ("Nenhuma predefinição foi liberada") **deixa de ser um beco**: sem
  predefinição, a pessoa ainda escolhe as próprias colunas.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- Funciona no celular: a lista de métricas rola e as caixinhas são clicáveis com o dedo.
- Testes que provam: cliente sem permissão de gerenciar CONSEGUE escolher as próprias colunas e
  NÃO consegue criar, renomear, excluir nem definir o padrão da organização; a escolha pessoal
  sobrevive à remontagem; "Voltar ao padrão" limpa; organização sem predefinição continua
  permitindo escolha pessoal.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**. **Não toque nos outros arquivos de
  `.changes/`.**
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**

---

## Parte B: o mesmo vale para "Escolher métricas" (os cards do topo)

`PriorityMetricSelector.tsx` some inteiro para quem não é admin de plataforma (`if (!canManage)
return null`, linha 111). O dono pediu em 24/09/2026, com o print do botão na mão: "isso aqui
também precisa estar disponível pra todo mundo, cada usuário escolhe o que quiser, e também
precisa ficar mais em evidência, desse jeito tá meio apagado".

1. **Todo usuário escolhe e ordena os cards do topo para si**, entre TODAS as métricas
   disponíveis (`PRIORITY_METRIC_COLUMNS`), sem limite por papel. A escolha é pessoal, por
   organização, e volta igual na próxima visita (`localStorage`, como o resto desta leva).
2. **Definir o padrão da organização continua com quem administra a plataforma.** Quem não
   administra altera só a própria tela; um botão **"Voltar ao padrão"** devolve ao padrão da
   organização e apaga a escolha pessoal.
3. **O botão sai do apagado.** Hoje é uma borda fina com texto de 12px que se perde ao lado dos
   números. Deixe com cara de botão de verdade: peso e contraste de ação secundária sólida, do
   mesmo tamanho dos outros controles da barra (Período, Baixar relatório, Colunas), alinhado com
   eles. Ele é a porta de um recurso que quase ninguém achou.
4. Quando a pessoa está com escolha própria, uma frase curta diz isso, para ela entender por que
   a tela dela difere da de um colega.

Testes: quem não administra VÊ o botão, consegue escolher e ordenar para si, NÃO consegue mudar o
padrão da organização, e "Voltar ao padrão" limpa a escolha pessoal.

---

## Princípio que rege esta leva inteira (palavras do dono, 24/09/2026)
> "Pode ser padrão, mas depois quem quiser mudar tem essa liberdade."

Vale para os três controles do Relatório (**Colunas**, **Escolher métricas** e a **seleção de
campanhas**):

- **O padrão existe e é bom:** quem abre pela primeira vez encontra uma tela pronta, definida pelo
  padrão da organização. Ninguém precisa configurar nada para usar.
- **O padrão nunca vira trava:** qualquer pessoa, de qualquer papel, muda a própria visão quando
  quiser, e o caminho de volta ("Voltar ao padrão") está sempre à mão.
- **Mudar para si nunca muda para os outros.** Só quem administra a plataforma mexe no padrão da
  organização.

E os três controles ficam **com a mesma cara e na mesma barra**: mesmo tamanho, mesmo peso, mesmo
tipo de janela ao abrir. São três portas do mesmo recurso (escolher o que eu quero ver); com três
formatos diferentes, a pessoa aprende três vezes e não acha nenhum.
