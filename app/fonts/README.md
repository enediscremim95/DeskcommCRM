# Fontes locais do produto e da vitrine

As famílias, pesos, eixos variáveis e nomes das variáveis CSS existentes são preservados. As fontes são distribuídas com o código e carregadas por `next/font/local`, tanto no produto quanto na vitrine. O build não consulta Google Fonts.

`SOURCES.json` fixa o commit do repositório oficial google/fonts, URLs de origem e SHA-256 dos arquivos. Cada família preserva sua licença OFL. Os TTFs oficiais foram apenas convertidos para WOFF2 com fonttools 4.68.0 / brotli 1.2.1, sem alteração de glifos ou eixos.

Motivo: a falha de download de arquivos no `next/font/google` pode aparecer como módulo interno ausente no Turbopack: https://github.com/vercel/next.js/issues/97378 e https://github.com/vercel/next.js/pull/99574. A correção é remover a dependência de rede da compilação, mantendo as fontes reais e todos os checks.

Atualizar: buscar a nova versão em um commit revisado do upstream, preservar OFL, converter sem subsetting, atualizar o manifesto e conferir build e aparência. Não substituir por fonte de fallback nos testes.
