# Agenda com reunião sem depender do Google

## Regra confirmada

O Google Meet só pode ser criado quando a conexão do responsável está saudável e existe exatamente uma agenda de destino gravável. Sem essa condição, o compromisso continua confirmado e recebe uma sala Jitsi própria.

Um tipo `video_link` respeita a URL cadastrada. Se não houver URL cadastrada, recebe a mesma alternativa Jitsi.

A recuperação posterior do Google não substitui uma sala Jitsi já pronta. Uma resposta `401` ou `invalid_grant` expira a conexão, abre aviso na Central e pede reconexão na Agenda.

O convite `.ics` da alternativa Jitsi é enviado somente ao e-mail do responsável. O contato não é incluído como destinatário.
