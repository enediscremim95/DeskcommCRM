---
impacto: nada_mudou
secao: corrigido
titulo: Troca de organização e menu não travam mais quando a autenticação demora
---
A autenticação agora tem prazo e a sessão renovada chega à tela na mesma requisição; antes, um soluço do servidor de login deixava a troca de organização presa em "Carregando organização", o link Relatório sem reação e, no fim, tela em branco ou login. Agora aparece "Autenticação temporariamente indisponível. Tente novamente em instantes." com botão para repetir, e o Relatório responde ao clique na hora.
