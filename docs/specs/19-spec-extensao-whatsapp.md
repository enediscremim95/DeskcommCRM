# Especificação 19: apoio humano no WhatsApp Web

## Estado

Implementado em 24/09/2026.

## Objetivo

Dar ao atendente contexto e ações do CRM ao lado da conversa aberta no WhatsApp Web, sem criar um segundo canal de automação e sem entregar uma credencial ampla ao navegador.

## Arquitetura decidida

O CRM gera um código aleatório de uso único para a sessão autenticada. A página o envia diretamente a uma extensão com ID fixo. A extensão troca o código por um token efêmero, guardado somente em `chrome.storage.session`, e nunca mostra ou pede token ao operador.

O token carrega um único usuário, uma única organização e uma única origem do CRM. A página autenticada envia presença a cada cinco segundos. Toda rota da extensão exige origem e ID exatos, token válido, vínculo ativo com o tenant e presença recente. Fechar o CRM, sair da conta, trocar de empresa ou expirar a sessão faz a extensão falhar fechada com `Entre no CRM para usar.`

O pacote é gerado pelo próprio CRM porque a origem autorizada entra no Manifest V3. Não existe permissão curinga. O código de página que conversa com o WhatsApp é local ao pacote e isola somente quatro operações: reconhecer a conversa ativa, preencher texto, enviar um arquivo de voz e informar erro.

## Áudio

Somente respostas rápidas compartilhadas aceitam áudio, e somente gerente ou administrador altera esse arquivo. O navegador pode enviar formatos de áudio comuns para a API, mas o servidor sempre recodifica com FFmpeg para mono, 48 kHz, OGG/Opus e registra `audio/ogg; codecs=opus`. Conversão duvidosa falha sem guardar o arquivo.

Os objetos ficam no bucket privado `whatsapp-media`, sob o prefixo da organização. Troca ou remoção do áudio não apaga em linha: um trigger coloca o objeto antigo em `storage_redaction_queue`, preservando a trilha LGPD existente.

No WhatsApp Web, o áudio passa por `@wppconnect/wa-js` e a única chamada de envio é `sendFileMessage` com `type: "audio"` e `isPtt: true`. Não há fallback como anexo comum.

## Escopo deliberadamente ausente

- disparo em massa;
- agendamento;
- resposta automática;
- envio automático de texto;
- token manual;
- acesso quando a sessão do CRM não está presente.

## Autoridades

- Sessão e organização ativa: CRM.
- Isolamento de tenant: RLS e filtro explícito por `organization_id`.
- Conversa aberta: WhatsApp Web, lida no instante da ação.
- Formato de voz: servidor, depois da recodificação.
- Envio da voz: biblioteca injetada localmente na página do WhatsApp.

## Provas obrigatórias

- migration, baseline e manifesto sincronizados;
- RLS da tabela de pareamentos contra acesso cruzado;
- CORS limitado à origem fixa da extensão;
- pacote sem origem curinga e sem biblioteca remota;
- conversão Opus estrita e falha fechada;
- chamada de voz com `isPtt: true`;
- tela de instalação responsiva e com pareamento sem cópia de segredo;
- typecheck, lint dos arquivos tocados, testes unitários, invariantes de banco e jornada visual.
