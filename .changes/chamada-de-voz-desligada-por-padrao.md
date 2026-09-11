---
impacto: capacidade_nova
secao: adicionado
titulo: Chamada de voz pelo WhatsApp — desligada por padrão, e com botão de desligar de verdade
---

O sistema passa a poder fazer e receber **chamadas de voz pelo WhatsApp**, e ela chega
**desligada**. Atualizar não liga nada: nenhum número seu é conectado a nada, nenhum serviço
novo sobe na sua VPS, e nada muda na sua tela até você decidir.

A razão de tanto cuidado está escrita na própria tela, antes do botão: para fazer chamadas, o
sistema precisa conectar **um segundo aparelho** ao mesmo número de WhatsApp que você já usa
para atender — e essa conexão não é feita pelo caminho oficial do WhatsApp. Se ele entender
isso como uso indevido, quem é bloqueada é a **conta**, não só a chamada: você perde também as
mensagens desse número. Por isso ligar é decisão de quem administra a empresa, exige marcar
que leu o aviso, e fica registrado quem aceitou e quando.

E desligar desliga mesmo. Antes, o único botão que existia era o de conectar — não havia
caminho de volta: apagar a configuração escondia a tela e deixava o aparelho vinculado ao seu
número para sempre, do lado do WhatsApp. Agora, ao desligar, o sistema **desconecta o aparelho**
de verdade e só então marca como desligado; se a desconexão falhar, ele avisa e mantém tudo
como estava, em vez de dizer que acabou com o aparelho ainda lá.

No servidor, o serviço de chamada de voz também nasce desligado: ele só é criado quando quem
administra a instalação o liga no arquivo de configuração. Quem não usar a chamada de voz não
paga por ela — nem em memória da VPS, nem em superfície exposta. O serviço usado é o oficial
do projeto WaCalls, fixado por versão exata e com login obrigatório; ele não é acessível pela
internet, apenas pelo próprio sistema.

Trabalho original de @eudanielhenrique.
