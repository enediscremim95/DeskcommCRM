#!/usr/bin/env bash
# Testes do porteiro de deploy. Docker e curl são dublês: este arquivo nunca
# toca a VPS nem sobe contêiner real.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy-producao.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
check() {
  if "${@:2}"; then
    printf '  ✓ %s\n' "$1"
  else
    printf '  ✗ %s\n' "$1"
    FAILS=$((FAILS + 1))
  fi
}

mkdir -p "$WORK/bin" "$WORK/project"
cp "$ROOT/docker-compose.prod.yml" "$WORK/project/docker-compose.prod.yml"
cp "$ROOT/docker-compose.traefik.yml" "$WORK/project/docker-compose.traefik.yml"
cp "$ROOT/docker-compose.dominios.yml" "$WORK/project/docker-compose.dominios.yml"
printf 'DOMAIN=crm.agenciaveritasdigital.com\n' > "$WORK/project/.env"

cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = inspect ]; then
  printf '172.18.0.5\n'
  exit 0
fi
if mkdir "$FAKE_DOCKER_ACTIVE" 2>/dev/null; then
  trap 'rmdir "$FAKE_DOCKER_ACTIVE" 2>/dev/null || true' EXIT
else
  : > "$FAKE_DOCKER_CONCURRENT"
fi
printf 'start %s\n' "$$" >> "$FAKE_DOCKER_RUNS"
sleep "${FAKE_DOCKER_SLEEP:-0.4}"
[ "${FAKE_DEPLOY_FAIL:-0}" = 1 ] && exit 42
printf 'end %s\n' "$$" >> "$FAKE_DOCKER_RUNS"
STUB
chmod +x "$WORK/bin/docker"

cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
url="${!#}"
printf '%s\n' "$*" >> "$FAKE_CURL_CALLS"
if [ -n "${FAKE_CURL_FAIL_DOMAIN:-}" ] && [[ "$*" == *"$FAKE_CURL_FAIL_DOMAIN"* ]]; then
  printf '404'
  exit 0
fi
printf '307'
STUB
chmod +x "$WORK/bin/curl"

export PATH="$WORK/bin:$PATH"
export DEPLOY_PROJECT_DIR="$WORK/project"
export DEPLOY_ENV_FILE="$WORK/project/.env"
export DEPLOY_DOMAINS_FILE="$WORK/project/docker-compose.dominios.yml"
export DEPLOY_HEARTBEAT_INTERVAL_SECONDS=0.1
export DEPLOY_STALE_AFTER_SECONDS=2
export DEPLOY_WAIT_INTERVAL_SECONDS=0.1
export DEPLOY_VERIFY_ATTEMPTS=1
export DEPLOY_VERIFY_INTERVAL_SECONDS=0
export FAKE_DOCKER_ACTIVE="$WORK/docker-active"
export FAKE_DOCKER_CONCURRENT="$WORK/docker-concurrent"
export FAKE_DOCKER_RUNS="$WORK/docker-runs"
export FAKE_CURL_CALLS="$WORK/curl-calls"

novo_caso() {
  local name="$1"
  export DEPLOY_LOCK_DIR="$WORK/$name.lock"
  export DEPLOY_LOG_FILE="$WORK/$name.log"
  rm -rf "$DEPLOY_LOCK_DIR" "$DEPLOY_LOCK_DIR".arrombada.*
  rm -f "$DEPLOY_LOG_FILE" "$FAKE_DOCKER_CONCURRENT" "$FAKE_DOCKER_RUNS" "$FAKE_CURL_CALLS"
  rmdir "$FAKE_DOCKER_ACTIVE" 2>/dev/null || true
}

printf '\n▶ duas entradas simultâneas\n'
novo_caso simultaneas
FAKE_DOCKER_SLEEP=0.5 bash "$SCRIPT" --session sessao-a --tag imagem-a > "$WORK/a.out" 2>&1 &
p1=$!
for _ in $(seq 1 50); do [ -d "$DEPLOY_LOCK_DIR" ] && break; sleep 0.02; done
FAKE_DOCKER_SLEEP=0.2 bash "$SCRIPT" --session sessao-b --tag imagem-b > "$WORK/b.out" 2>&1 &
p2=$!
wait "$p1"; rc1=$?
wait "$p2"; rc2=$?
check 'as duas sessões terminam com sucesso' test "$rc1" -eq 0 -a "$rc2" -eq 0
check 'apenas uma sessão entra no docker por vez' test ! -f "$FAKE_DOCKER_CONCURRENT"
check 'a segunda sessão viu a porta ocupada' grep -q 'OCUPADO:' "$WORK/b.out"
check 'o livro registra os dois deploys' test "$(grep -c 'event=deploy_finalizado' "$DEPLOY_LOG_FILE")" -eq 2

printf '\n▶ heartbeat recente não permite arrombamento\n'
novo_caso heartbeat-recente
export DEPLOY_STALE_AFTER_SECONDS=30
mkdir "$DEPLOY_LOCK_DIR"
cat > "$DEPLOY_LOCK_DIR/owner" <<EOF
session=sessao-dona
entered_at=2026-09-29T12:00:00Z
entered_at_epoch=$(date +%s)
deployment=imagem-dona
pid=999999
pid_start=
host=$(hostname)
token=dona
EOF
date +%s > "$DEPLOY_LOCK_DIR/heartbeat"
bash "$SCRIPT" --session sessao-espera --tag imagem-espera > "$WORK/recente.out" 2>&1 &
waiter=$!
for _ in $(seq 1 100); do
  grep -q 'Sinal recente' "$WORK/recente.out" 2>/dev/null && break
  sleep 0.05
done
kill "$waiter" 2>/dev/null || true
wait "$waiter" 2>/dev/null || true
check 'a tranca original continua no lugar' grep -q '^session=sessao-dona$' "$DEPLOY_LOCK_DIR/owner"
check 'a saída explica que o sinal é recente' grep -q 'Sinal recente' "$WORK/recente.out"
check 'nenhum arrombamento foi registrado' bash -c '! grep -q "event=arrombamento" "$1" 2>/dev/null' _ "$DEPLOY_LOG_FILE"
rm -f "$DEPLOY_LOCK_DIR/owner" "$DEPLOY_LOCK_DIR/heartbeat"
rmdir "$DEPLOY_LOCK_DIR"
export DEPLOY_STALE_AFTER_SECONDS=2

printf '\n▶ heartbeat parado e PID morto permite arrombamento\n'
novo_caso heartbeat-morto
mkdir "$DEPLOY_LOCK_DIR"
cat > "$DEPLOY_LOCK_DIR/owner" <<EOF
session=sessao-morta
entered_at=2026-09-29T12:00:00Z
entered_at_epoch=$(( $(date +%s) - 30 ))
deployment=imagem-antiga
pid=999999
pid_start=
host=$(hostname)
token=morta
EOF
printf '%s\n' "$(( $(date +%s) - 30 ))" > "$DEPLOY_LOCK_DIR/heartbeat"
DEPLOY_STALE_AFTER_SECONDS=1 bash "$SCRIPT" --session sessao-nova --tag imagem-nova > "$WORK/morto.out" 2>&1
rc=$?
check 'a nova sessão assume e termina com sucesso' test "$rc" -eq 0
check 'o arrombamento nomeia a sessão anterior' grep -q 'event=arrombamento.*old_session="sessao-morta"' "$DEPLOY_LOG_FILE"
check 'o livro registra quanto tempo a tranca ficou muda' grep -q 'silent_seconds=' "$DEPLOY_LOG_FILE"
check 'a tranca é liberada ao final' test ! -d "$DEPLOY_LOCK_DIR"

printf '\n▶ heartbeat parado com PID vivo não permite arrombamento\n'
novo_caso heartbeat-vivo
sleep 30 &
holder=$!
mkdir "$DEPLOY_LOCK_DIR"
cat > "$DEPLOY_LOCK_DIR/owner" <<EOF
session=sessao-viva
entered_at=2026-09-29T12:00:00Z
entered_at_epoch=$(( $(date +%s) - 30 ))
deployment=imagem-viva
pid=$holder
pid_start=
host=$(hostname)
token=viva
EOF
printf '%s\n' "$(( $(date +%s) - 30 ))" > "$DEPLOY_LOCK_DIR/heartbeat"
DEPLOY_STALE_AFTER_SECONDS=1 bash "$SCRIPT" --session sessao-espera-viva --tag imagem-espera > "$WORK/vivo.out" 2>&1 &
waiter=$!
for _ in $(seq 1 100); do
  grep -q 'continua vivo' "$WORK/vivo.out" 2>/dev/null && break
  sleep 0.05
done
kill "$waiter" 2>/dev/null || true
wait "$waiter" 2>/dev/null || true
kill "$holder" 2>/dev/null || true
wait "$holder" 2>/dev/null || true
check 'a tranca de processo vivo continua no lugar' grep -q '^session=sessao-viva$' "$DEPLOY_LOCK_DIR/owner"
check 'a saída explica por que não arrombou' grep -q 'continua vivo' "$WORK/vivo.out"
check 'processo vivo não gera registro de arrombamento' bash -c '! grep -q "event=arrombamento" "$1" 2>/dev/null' _ "$DEPLOY_LOG_FILE"
rm -f "$DEPLOY_LOCK_DIR/owner" "$DEPLOY_LOCK_DIR/heartbeat"
rmdir "$DEPLOY_LOCK_DIR"

printf '\n▶ falha do deploy libera a tranca\n'
novo_caso deploy-falha
FAKE_DEPLOY_FAIL=1 bash "$SCRIPT" --session sessao-falha --tag imagem-falha > "$WORK/falha.out" 2>&1
rc=$?
check 'o script falha alto quando o compose falha' test "$rc" -ne 0
check 'a tranca é liberada mesmo na falha' test ! -d "$DEPLOY_LOCK_DIR"
check 'o livro registra o resultado como falha' grep -q 'event=deploy_finalizado.*status=falha' "$DEPLOY_LOG_FILE"

printf '\n▶ domínio de cliente quebrado reprova o deploy\n'
novo_caso dominio-quebrado
export FAKE_CURL_FAIL_DOMAIN='crm.lecote.com.br'
bash "$SCRIPT" --session sessao-dominio --tag imagem-dominio > "$WORK/dominio.out" 2>&1
rc=$?
unset FAKE_CURL_FAIL_DOMAIN
check 'o deploy reprova quando um domínio de cliente responde 404' test "$rc" -ne 0
check 'a saída lista nominalmente o domínio quebrado' grep -q 'crm.lecote.com.br: HTTP 404' "$WORK/dominio.out"
check 'o domínio principal também foi conferido' grep -q 'https://crm.agenciaveritasdigital.com/' "$FAKE_CURL_CALLS"
for cliente in crm.imobiliariaa.com.br crm.zaparolliimoveis.com crm.lecote.com.br crm.alavancagem.site crm-imobiliariaa.agenciaveritasdigital.com; do
  check "o cliente $cliente foi conferido direto no app" grep -q -- "-H Host: $cliente http://172.18.0.5:3000/" "$FAKE_CURL_CALLS"
  check "o cliente $cliente não foi conferido pela Cloudflare" bash -c '! grep -q "https://$1/" "$2"' _ "$cliente" "$FAKE_CURL_CALLS"
done
check 'falha exclusiva da sonda usa o código reservado 10' test "$rc" -eq 10
check 'a tranca também é liberada após falha HTTP' test ! -d "$DEPLOY_LOCK_DIR"

printf '\n▶ cada host está nas três regras de roteamento\n'
for cliente in crm.imobiliariaa.com.br crm.zaparolliimoveis.com crm.lecote.com.br crm.alavancagem.site crm-imobiliariaa.agenciaveritasdigital.com; do
  check "$cliente aparece exatamente três vezes" test "$(grep -oF "$cliente" "$ROOT/docker-compose.dominios.yml" | wc -l)" -eq 3
done

printf '\n'
if [ "$FAILS" -gt 0 ]; then
  printf '✗ %d falha(s)\n' "$FAILS"
  exit 1
fi
printf '✓ porteiro de deploy: tudo verde\n'
