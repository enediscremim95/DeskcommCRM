# Runbook — Deploy em produção (VPS)

O caminho normal de deploy **não constrói nada na VPS**: o CI publica a imagem no
GHCR e a VPS só puxa. Construir localmente é exceção de emergência, e tem custo —
está documentado no fim.

---

## 1. A única porta de entrada

```bash
cd /opt/DeskcommCRM
bash scripts/deploy-producao.sh --session <id-da-sessao> --tag <tag-ou-imagem>
```

Para outro serviço, repita `--service`, por exemplo `--service worker`. Sem a
opção, o alvo é `app`. A sessão e a tag/imagem são obrigatórias porque ficam no
livro de registro e respondem quem subiu o quê.

**Não rode `docker compose up -d` diretamente.** O porteiro é o único caminho e
executa, sem alternativa com menos arquivos:

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.traefik.yml \
  -f docker-compose.dominios.yml \
  --env-file .env up -d app
```

### Os TRÊS `-f` são obrigatórios. Sempre.

Esta é a pegadinha que já derrubou o site inteiro em produção (2026-08-05).

A VPS (Hostinger) vem com um **Traefik próprio** ocupando as portas 80/443.
`docker-compose.traefik.yml` contém a infraestrutura comum do Traefik e:

- coloca no contêiner `app` as labels de roteamento
  (`traefik.http.routers.deskcomm.rule=Host(...)`);
- associa o contêiner à rede que o Traefik enxerga (`TRAEFIK_DOCKER_NETWORK`);
- desliga o `caddy` do compose base por profile (senão dois processos brigam
  pela mesma porta).

`docker-compose.dominios.yml` fica separado porque contém os hosts operacionais
desta instalação. Cada host novo entra nas três regras do arquivo: router
principal, router HTTP e `waha-block`.

Rodar sem o Traefik recria o contêiner sem o roteamento principal. Rodar sem o
arquivo de domínios preserva o domínio principal, mas apaga silenciosamente os
routers dos clientes. Em ambos os casos o Traefik responde `404 page not found`:
a app está no ar, saudável e inalcançável pelo endereço esquecido.

### Como funciona a tranca

O script escolhe `mkdir /var/lock/deskcommcrm-deploy.lock` como primitivo de
exclusão. A criação do diretório é atômica no filesystem; não existe intervalo
entre “vi que está livre” e “tranquei”. O caminho é global à VPS, então worktrees
diferentes disputando o mesmo Docker enxergam a mesma porta.

Dentro da tranca, `owner` informa sessão, hora de entrada, tag/imagem, PID, host
e token. `heartbeat` é atualizado a cada 5 segundos. Quem encontra a porta
ocupada mostra esses dados e espera, reavaliando a cada 5 segundos.

O limite de silêncio é **120 segundos**, equivalente a 24 heartbeats perdidos.
Ele tolera atraso de disco e de scheduler sem tratar um deploy legítimo de 10
minutos como morto. Mesmo depois do limite, o script confere o PID e não
arromba se o processo continua vivo. Com heartbeat parado e PID morto, move a
tranca atomicamente, registra o arrombamento e só então tenta entrar.

O livro fica em `/var/log/deskcommcrm/deploy.log`. Cada linha registra horário,
sessão, PID, tag/imagem, duração, resultado e eventual arrombamento. Para ler
quem está dentro e o histórico:

```bash
cat /var/lock/deskcommcrm-deploy.lock/owner
cat /var/lock/deskcommcrm-deploy.lock/heartbeat
tail -n 50 /var/log/deskcommcrm/deploy.log
```

---

## 2. Verificação pós-deploy (não pule)

`healthy` no `docker ps` **não prova que o site está acessível**. O porteiro
consulta publicamente o domínio principal e testa os hosts extraídos de
`docker-compose.dominios.yml` direto no IP do contêiner `deskcommcrm-app-1`, com
o header `Host`. Isso evita o falso negativo dos clientes atrás da Cloudflare,
que pode seguir o redirecionamento e devolver 200. A sonda repete durante até 2
minutos e exige HTTP 307 em todos os caminhos.

Para diagnóstico manual, sem subir nada:

```bash
# 1) as labels do Traefik existem?
#    O nome do contêiner é <pasta-do-projeto>-app-1, então pergunte ao compose.
docker inspect "$(docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml -f docker-compose.dominios.yml ps -q app)" \
  --format '{{.Config.Labels}}' | grep -o 'traefik.enable:[^ ]*'
# esperado: traefik.enable:true   (vazio = roteamento quebrado)

# 2) quais hosts o porteiro confere?
grep -oE 'Host\(`[^`]+`\)' docker-compose.dominios.yml | sort -u

# 3) um domínio responde?
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/
# esperado: 307. 404 = labels perdidas; o próximo deploy deve ser pelo porteiro.
```

### Por que a sonda do app é de vida

Em 05/10/2026, duas janelas de latência do Supabase deixaram a rota
`/api/v1/health` degradada. Como o healthcheck do Docker consultava essa rota,
cinco falhas marcaram o contêiner `unhealthy`; o Traefik o retirou do roteamento
e o CRM inteiro respondeu 404 por cerca de 10 minutos em cada janela, inclusive
o login e os webhooks do WhatsApp.

Por isso a sonda do serviço `app` mede somente vida: o processo precisa aceitar
conexão TCP na porta 3000. O estado de Supabase, Redis e WAHA continua exposto
pela rota de saúde e consumido pela vigia independente. Degradação de
dependência deve gerar **alerta**, nunca decidir o roteamento público.

**Atenção, a autocura TEM gatilho externo.** A decisão de reiniciar o app após três
`PGRST003` consecutivos vive em `lib/health/auto-cura-banco.ts`, mas só é avaliada
quando a rota `GET /api/v1/health` recebe o cabeçalho `x-self-heal-probe: 1` junto do
segredo interno (`app/api/v1/health/route.ts`). Antes de 05/10/2026 quem mandava isso
era a sonda do Docker; ao trocá-la pela sonda de vida, a autocura ficou **desligada por
algumas horas** até o gatilho ser devolvido. Hoje o gatilho é a vigia
(`vigia_silencio_crm.py`, cron de 1 minuto). **Quem instalar sem a vigia não tem
autocura.** Seguimento: um temporizador interno do app que dispare a avaliação sem
depender de ninguém de fora.

### Deploy com volta automática

Para trocar as três imagens e voltar sozinho se a versão nova não passar nas
sondas:

```bash
bash scripts/deploy-com-rollback.sh --session <id-da-sessao> --tag <nova-tag>
```

O wrapper guarda `.env.bak-antes-<nova-tag>`, chama o porteiro para `app`,
`worker` e `scheduler`, confere health e versão, rotas, saúde dos contêineres e
erros críticos recentes. Saída `0` significa deploy aprovado. Saída `20`
significa versão nova reprovada e rollback aprovado. Saída `30` significa que o
rollback também falhou e exige intervenção manual. Erros de argumento ou do
`.env` saem com `1` antes de alterar as imagens.

Migration não faz parte deste script. Ela deve ser aditiva e aplicada antes do
deploy; voltar a imagem não desfaz migration.

---

## 3. Fluxo completo (do código à produção)

```
commit → push → PR → merge na main → CI publica imagem → VPS puxa
```

1. **Commit + push** numa branch de feature. Trabalho que fica só no disco da
   VPS não existe: o CI não o vê, some se a VPS for reconstruída, e é invisível
   pra qualquer outra pessoa.
2. **PR e merge na `main`.** `publish-image.yml` dispara em push na `main` (ou
   tag `v*`) e publica **três** imagens — `deskcommcrm`, `deskcomm-worker` e
   `deskcomm-scheduler` — sempre na mesma versão. O build pesado roda nos
   runners do GitHub, nunca na VPS do usuário.
3. **Deploy na VPS.** Numa instalação real isto é `bash hostgator-setup-kit/update.sh`,
   não um `up -d` na mão: ele puxa a tag publicada, re-aplica o `baseline.sql`,
   faz backup antes e grava as três imagens no `.env`.

> **`latest` não é a última release.** Ele é publicado a partir da branch default, então
> segue o **topo da `main`** — código ainda não lançado. Quem quer a última release usa
> `stable`; quem opera um cliente usa o número da versão. Ver
> [`../doctrine/packaging.md`](../doctrine/packaging.md).

---

## 4. Exceção: imagem construída na VPS

Só quando é preciso validar algo em produção **antes** de a imagem oficial
existir (ex.: CI ainda rodando e um bug bloqueando o usuário).

```bash
APP_IMAGE=deskcomm-app:local docker compose \
  -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env build app

APP_IMAGE=deskcomm-app:local APP_PULL_POLICY=never bash scripts/deploy-producao.sh \
  --session <id-da-sessao> --tag deskcomm-app:local
```

O `docker-compose.build.yml` também cobre `worker` e `scheduler` — troque
`app` pelo serviço que você precisa construir. Eles têm `build:` no próprio
compose de produção (é o escape que faz a instalação sobreviver a um registry
fora do ar), mas é o override que traz o `pull_policy: never`; sem ele o
`up -d` volta a buscar a imagem publicada.

**Isto é dívida, não um caminho paralelo.** A imagem existe só no disco daquela
VPS: não está no registry, não está no git, e qualquer `docker compose up -d`
sem `APP_PULL_POLICY=never` a substitui pela do GHCR — silenciosamente, sem erro
nenhum, revertendo o que você acabou de subir.

Requisitos: >= 4 GB de RAM **ou** swap (medido: ~4min num VPS de 3.8 GB com 4 GB
de swap) — e isto é o requisito **deste caminho de exceção**, não da operação
normal. A régua de operação é outra, e não mudou. Ela tem três parcelas, e **duas
são medidas e uma é herdada** — a distinção importa porque a herdada é a que
costuma ser citada como se fosse nossa:

| parcela | estado | como conferir |
|---|---|---|
| 7 contêineres | **medido** | `docker compose -f docker-compose.prod.yml config --services \| wc -l` |
| `mem_limit` somando 2560m (app 768 + worker 512 + waha 1280) | **medido** | `grep -n 'mem_limit' docker-compose.prod.yml` |
| ~150 MB por número de WhatsApp | **herdado do upstream WAHA**, nunca medido neste projeto | `docker stats --no-stream` na sua VPS |

O terceiro número vem de `docs/research/reference-synthesis.md` (síntese do curso
WAHA, 2026-05), não de uma medição nossa — e circula em sete documentos que se
citam entre si. Uma medição pontual na produção do projeto (2026-08-14, **uma**
sessão pareada, VPS compartilhada com outras stacks) deu **304,5 MiB no contêiner
`waha` inteiro**, contra o `mem_limit` de 1280 MiB. Um ponto não decompõe baseline
e sessão: para isso seriam necessários dois números pareados, e não é ensaio que
se faça numa instalação viva.

**Nada disso mexe no tier recomendado.** A régua que sustenta os 4 GB é a soma da
stack em operação, não o WAHA isolado — e a folga existe justamente porque a
parcela por sessão não é conhecida com precisão.

Ao terminar, feche o ciclo — merge na `main` e volte a VPS pra imagem oficial.
