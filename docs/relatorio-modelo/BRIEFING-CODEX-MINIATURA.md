# Briefing: miniatura errada dos criativos e Kroebel no relatório (15/10/2026)

O dono mostrou a tabela "Criativo" do relatório do CRM: os anúncios de **imagem** do Bendito Ponto ("IMAGEM - Não para de crescer", "IMAGEM - Um novo modelo" etc.) aparecem com a **logo do Bendito Ponto** no lugar da imagem do criativo; os de vídeo ("Animação", "Embaixadora") mostram a miniatura certa. Ele também pediu: **não colocar a Kroebel** no relatório.

## Causa medida (Windsor, conta Meta 515325147823116, 15/10/2026)
Para esses anúncios de imagem, o campo `thumbnail_url` (e `promoted_post_full_picture`) que o Meta devolve **não é o criativo**: é a prévia do link do site de destino, um proxy do Facebook assim:
`https://external-fra3-1.xx.fbcdn.net/emg1/v/t13/<id>?url=https%3A%2F%2Fbendito-ponto-franquia.pages.dev%2Fimg%2Fog-image.jpg&fb_obo=1&utld=bendito-ponto-franquia.pages.dev&...` (a logo do `og-image.jpg` do site). `image_url` vem `null`.
A imagem **real** de cada criativo vem em `effective_instagram_media__media_url` (jpg em `scontent-*.cdninstagram.com`, um URL diferente por criativo). Esse campo combina com `ad_name` na mesma requisição (testado); o grupo "Ad Images" (`image_hash`, `image_library_url_128`) NÃO combina e não deve ser usado.
Hoje `lib/windsor/normalizer.ts` faz `thumbnail_url: text(row, "thumbnail_url", "image_url")`, então a prévia do link vence.

## O que fazer
1. **Buscar o campo certo.** Em `lib/windsor/account-fetch.ts`, incluir `effective_instagram_media__media_url` nos campos de mídia da Meta (e nas exclusões do resumo sem detalhe de anúncio, junto de `thumbnail_url`/`image_url`).
2. **Escolher a imagem certa** em `lib/windsor/normalizer.ts` com uma função pura e testada, por exemplo `escolherImagemDoCriativo(row)`: descarte `thumbnail_url`/`image_url` quando for **prévia de link** (host `external-*.xx.fbcdn.net` com caminho `/emg1/` ou com parâmetro `url=` apontando para outro site; ou `utld=`), e então prefira nesta ordem: `thumbnail_url` legítimo (vídeo), `effective_instagram_media__media_url`, `image_url`. Se nada sobrar, `null`.
3. **Não mostrar a prévia de link mesmo nos dados antigos.** As linhas já gravadas em `traffic_dashboard_facts` têm a prévia de link. Em `lib/windsor/report.ts` (onde `thumbnail_url` do anúncio é montado a partir dos fatos, linhas ~499 a ~507), aplique a mesma função de descarte e prefira a miniatura do fato **mais recente** válido (não a primeira), para que, depois da próxima sincronização, o URL novo apareça sem migration. Sem miniatura, a tela mostra o marcador neutro que ela já usa (confira em `app/app/relatorio/_components/TrafficDashboard.tsx` ~748 e `RichReportSections.tsx` ~688 que o vazio não vira logo da organização nem imagem quebrada).
4. **Sincronização:** confirme se uma nova sincronização reescreve `thumbnail_url` das linhas dos últimos dias (a janela e o upsert). Se o relatório lê a miniatura de linhas antigas que a sincronização não reescreve, documente o que falta para atualizar e, se for pequeno e seguro (sem migration destrutiva), faça a atualização da miniatura nas linhas já gravadas pelo caminho normal de sincronização. Não invente rota nova nem mexa em dado de outra organização: tudo filtrado por `organization_id`.
5. **Tirar a Kroebel do relatório em slides** (`lib/windsor/traffic-summary-slides.ts`): remova o caso especial `isBendito` e o uso de `slideModel.benditoLogo`/`benditoBadge`; para qualquer organização, capa e encerramento usam a marca da própria organização (`resolvedLogo(args.brand, ...)`) ou só o nome em texto quando não houver logo. Apague `lib/windsor/assets/traffic-summary-slides-model.json` se ficar sem uso (ele guarda os logos da Kroebel em base64), ajuste o que o importava, e atualize `docs/relatorio-modelo/BRIEFING-CODEX.md` e os comentários/testes que afirmam o contrário. O texto "Kroebel Franchising" não pode mais aparecer em nenhum relatório gerado.
6. **PDF** (`lib/windsor/traffic-summary-pdf.tsx` e `pdf-thumbnails.ts`): usa a mesma miniatura; confira que o PDF herda a correção e que não há logo da Kroebel nele.

## Testes obrigatórios
- Unitários da função de escolha: prévia de link descartada (use o URL real acima como fixture), vídeo com `thumbnail_url` legítimo mantido, imagem sem thumbnail usa `effective_instagram_media__media_url`, tudo vazio devolve `null`.
- `report.ts`: dado antigo com prévia de link não vira miniatura; fato mais recente válido vence.
- Slides: nenhum HTML gerado (organização `bendito-ponto` ou qualquer outra) contém "Kroebel"; capa sem logo quando a organização não tem logo.
- Rodar a suíte inteira (`pnpm test:unit` sem caminho; se `pnpm` não existir no PATH use `npx vitest run`), `npx tsc --noEmit -p tsconfig.typecheck.json`, `npx tsx scripts/lint-channels.ts` e o lint dos arquivos tocados. Fragmento em `.changes/` (efeito: `nada_mudou`, seção `corrigido`). Sem commit nem push.

## Regras do repositório
`CLAUDE.md` na raiz: multi-tenant (`organization_id` de fonte confiável), moeda nativa, Zod em entrada externa, sem `console.log`, i18n em texto novo, sem migration de banco nesta mudança.
