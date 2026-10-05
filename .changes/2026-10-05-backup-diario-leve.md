---
impacto: nada_mudou
secao: corrigido
titulo: Backup diário deixa de pesar no banco
---

O backup diário não copia mais as linhas do log bruto de webhooks (a tabela continua no backup, vazia), que levava cerca de 10 minutos de leitura pesada e podia deixar o app lento em bancos pequenos. Leads, mensagens, contatos e todo o restante continuam no backup como antes.
