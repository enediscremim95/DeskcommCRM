#!/usr/bin/env bash
# Porteiro único de deploy da VPS Veritas.
#
# `mkdir` é a tranca: a criação de um diretório é atômica no filesystem. Isso
# evita o intervalo inseguro de "testar se existe" e só depois criar. O lock é
# fixo em /var/lock para que worktrees diferentes disputando o mesmo Docker
# enxerguem a mesma porta, e guarda metadados legíveis por qualquer sessão.
set -Eeuo pipefail

PROJECT_DIR="${DEPLOY_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOCK_DIR="${DEPLOY_LOCK_DIR:-/var/lock/deskcommcrm-deploy.lock}"
LOG_FILE="${DEPLOY_LOG_FILE:-/var/log/deskcommcrm/deploy.log}"
ENV_FILE="${DEPLOY_ENV_FILE:-$PROJECT_DIR/.env}"
DOMAINS_FILE="${DEPLOY_DOMAINS_FILE:-$PROJECT_DIR/docker-compose.dominios.yml}"
HEARTBEAT_INTERVAL="${DEPLOY_HEARTBEAT_INTERVAL_SECONDS:-5}"
STALE_AFTER="${DEPLOY_STALE_AFTER_SECONDS:-120}"
WAIT_INTERVAL="${DEPLOY_WAIT_INTERVAL_SECONDS:-5}"
VERIFY_ATTEMPTS="${DEPLOY_VERIFY_ATTEMPTS:-24}"
VERIFY_INTERVAL="${DEPLOY_VERIFY_INTERVAL_SECONDS:-5}"

SESSION_ID=""
DEPLOYMENT=""
SERVICES=()
LOCK_ACQUIRED=0
HEARTBEAT_PID=""
LOCK_TOKEN=""
ENTERED_AT_EPOCH=""
FORCED_TAKEOVER=0
DEPLOY_OK=0

usage() {
  cat <<'USAGE'
Uso:
  bash scripts/deploy-producao.sh --session <id> --tag <tag-ou-imagem> [--service <serviço> ...]

Exemplos:
  bash scripts/deploy-producao.sh --session codex-abc123 --tag 1.8.0
  bash scripts/deploy-producao.sh --session manutencao-42 --tag deskcomm-app:local --service app

Sem --service, sobe apenas o serviço app. Todo caminho usa obrigatoriamente os
três arquivos: prod, traefik e dominios.
USAGE
}

die() {
  printf 'ERRO: %s\n' "$*" >&2
  exit 1
}

sanitizar() {
  printf '%s' "$1" | tr '\r\n\t' '   '
}

log_event() {
  local event="$1"
  shift
  mkdir -p "$(dirname "$LOG_FILE")"
  printf 'timestamp=%s event=%s session="%s" pid=%s deployment="%s" %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" "$(sanitizar "$SESSION_ID")" \
    "$$" "$(sanitizar "$DEPLOYMENT")" "$*" >> "$LOG_FILE"
}

campo_owner() {
  local field="$1" file="${2:-$LOCK_DIR/owner}"
  [ -f "$file" ] || return 1
  awk -F= -v key="$field" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

pid_start_atual() {
  local pid="$1"
  [ -r "/proc/$pid/stat" ] || return 1
  awk '{ print $22 }' "/proc/$pid/stat"
}

pid_registrado_vivo() {
  local pid="$1" esperado="${2:-}" atual
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [ -n "$esperado" ]; then
    atual="$(pid_start_atual "$pid" 2>/dev/null || true)"
    [ -n "$atual" ] && [ "$atual" = "$esperado" ] || return 1
  fi
}

heartbeat_epoch() {
  local value=""
  if [ -f "$LOCK_DIR/heartbeat" ]; then
    read -r value < "$LOCK_DIR/heartbeat" || true
  fi
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s' "$value"
  elif [ -d "$LOCK_DIR" ]; then
    stat -c %Y "$LOCK_DIR" 2>/dev/null || printf '0'
  else
    printf '0'
  fi
}

idade_heartbeat() {
  local now hb age
  now="$(date +%s)"
  hb="$(heartbeat_epoch)"
  age=$((now - hb))
  [ "$age" -ge 0 ] || age=0
  printf '%s' "$age"
}

escrever_owner() {
  local tmp="$LOCK_DIR/owner.tmp.$$" pid_start
  pid_start="$(pid_start_atual "$$" 2>/dev/null || true)"
  {
    printf 'session=%s\n' "$(sanitizar "$SESSION_ID")"
    printf 'entered_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'entered_at_epoch=%s\n' "$ENTERED_AT_EPOCH"
    printf 'deployment=%s\n' "$(sanitizar "$DEPLOYMENT")"
    printf 'pid=%s\n' "$$"
    printf 'pid_start=%s\n' "$pid_start"
    printf 'host=%s\n' "$(hostname)"
    printf 'token=%s\n' "$LOCK_TOKEN"
  } > "$tmp"
  mv -f "$tmp" "$LOCK_DIR/owner"
  printf '%s\n' "$ENTERED_AT_EPOCH" > "$LOCK_DIR/heartbeat"
}

mostrar_ocupante() {
  local age="$1" session pid entered deployment
  session="$(campo_owner session 2>/dev/null || printf 'inicializando')"
  pid="$(campo_owner pid 2>/dev/null || printf 'desconhecido')"
  entered="$(campo_owner entered_at 2>/dev/null || printf 'desconhecida')"
  deployment="$(campo_owner deployment 2>/dev/null || printf 'desconhecido')"
  printf 'OCUPADO: sessão=%s, PID=%s, entrada=%s, deploy=%s. Último sinal há %ss.\n' \
    "$session" "$pid" "$entered" "$deployment" "$age"
}

registrar_arrombamento() {
  local owner_file="$1" silence="$2" old_session old_pid old_deployment
  old_session="$(campo_owner session "$owner_file" 2>/dev/null || printf 'desconhecida')"
  old_pid="$(campo_owner pid "$owner_file" 2>/dev/null || printf 'desconhecido')"
  old_deployment="$(campo_owner deployment "$owner_file" 2>/dev/null || printf 'desconhecido')"
  log_event arrombamento \
    "old_session=\"$(sanitizar "$old_session")\" old_pid=$old_pid old_deployment=\"$(sanitizar "$old_deployment")\" silent_seconds=$silence"
}

arrombar_se_morto() {
  local age="$1" pid pid_start quarantine owner_snapshot
  pid="$(campo_owner pid 2>/dev/null || true)"
  pid_start="$(campo_owner pid_start 2>/dev/null || true)"

  if pid_registrado_vivo "$pid" "$pid_start"; then
    printf 'Sinal parado, mas o PID %s continua vivo. Não vou arrombar um deploy possivelmente em andamento.\n' "$pid"
    return 1
  fi

  quarantine="${LOCK_DIR}.arrombada.$(date +%s).$$"
  if mv "$LOCK_DIR" "$quarantine" 2>/dev/null; then
    owner_snapshot="$quarantine/owner"
    registrar_arrombamento "$owner_snapshot" "$age"
    FORCED_TAKEOVER=1
    printf 'ARROMBAMENTO REGISTRADO: tranca muda há %ss e PID morto. Tentando entrar.\n' "$age"
    rm -f "$quarantine/owner" "$quarantine/heartbeat" "$quarantine"/owner.tmp.* 2>/dev/null || true
    rmdir "$quarantine" 2>/dev/null || true
    return 0
  fi
  return 1
}

adquirir_lock() {
  local age
  mkdir -p "$(dirname "$LOCK_DIR")" "$(dirname "$LOG_FILE")"
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    age="$(idade_heartbeat)"
    mostrar_ocupante "$age"
    if [ "$age" -gt "$STALE_AFTER" ]; then
      arrombar_se_morto "$age" || true
    else
      printf 'Sinal recente. O correto é esperar; nova avaliação em %ss.\n' "$WAIT_INTERVAL"
    fi
    sleep "$WAIT_INTERVAL"
  done

  LOCK_ACQUIRED=1
  ENTERED_AT_EPOCH="$(date +%s)"
  LOCK_TOKEN="$$.$ENTERED_AT_EPOCH.$RANDOM"
  escrever_owner
}

iniciar_heartbeat() {
  (
    while kill -0 "$$" 2>/dev/null; do
      [ -d "$LOCK_DIR" ] || exit 0
      [ "$(campo_owner token 2>/dev/null || true)" = "$LOCK_TOKEN" ] || exit 0
      local_tmp="$LOCK_DIR/heartbeat.tmp.$$"
      printf '%s\n' "$(date +%s)" > "$local_tmp" || exit 0
      mv -f "$local_tmp" "$LOCK_DIR/heartbeat" || exit 0
      sleep "$HEARTBEAT_INTERVAL"
    done
  ) &
  HEARTBEAT_PID=$!
}

parar_heartbeat() {
  if [ -n "$HEARTBEAT_PID" ]; then
    kill "$HEARTBEAT_PID" 2>/dev/null || true
    wait "$HEARTBEAT_PID" 2>/dev/null || true
    HEARTBEAT_PID=""
  fi
}

liberar_lock() {
  local token_atual
  [ "$LOCK_ACQUIRED" -eq 1 ] || return 0
  token_atual="$(campo_owner token 2>/dev/null || true)"
  if [ "$token_atual" = "$LOCK_TOKEN" ]; then
    rm -f "$LOCK_DIR/owner" "$LOCK_DIR/heartbeat" "$LOCK_DIR"/owner.tmp.* "$LOCK_DIR"/heartbeat.tmp.* 2>/dev/null || true
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  LOCK_ACQUIRED=0
}

ao_sair() {
  local rc=$? duration status
  trap - EXIT INT TERM HUP
  parar_heartbeat
  if [ "$LOCK_ACQUIRED" -eq 1 ]; then
    duration=$(($(date +%s) - ENTERED_AT_EPOCH))
    status="falha"
    [ "$rc" -eq 0 ] && [ "$DEPLOY_OK" -eq 1 ] && status="sucesso"
    log_event deploy_finalizado "status=$status exit_code=$rc duration_seconds=$duration arrombamento=$FORCED_TAKEOVER"
    liberar_lock
  fi
  exit "$rc"
}

trap ao_sair EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

while [ "$#" -gt 0 ]; do
  case "$1" in
    --session)
      [ "$#" -ge 2 ] || die '--session exige um valor'
      SESSION_ID="$2"
      shift 2
      ;;
    --tag|--image|--deployment)
      [ "$#" -ge 2 ] || die "$1 exige um valor"
      DEPLOYMENT="$2"
      shift 2
      ;;
    --service)
      [ "$#" -ge 2 ] || die '--service exige um valor'
      SERVICES+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "argumento desconhecido: $1"
      ;;
  esac
done

[ -n "$SESSION_ID" ] || die 'informe --session com o identificador desta sessão'
[ -n "$DEPLOYMENT" ] || die 'informe --tag com a tag ou imagem que está subindo'
[ "${#SERVICES[@]}" -gt 0 ] || SERVICES=(app)
for service in "${SERVICES[@]}"; do
  [[ "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "nome de serviço inválido: $service"
done
[ -f "$PROJECT_DIR/docker-compose.prod.yml" ] || die 'docker-compose.prod.yml não encontrado'
[ -f "$PROJECT_DIR/docker-compose.traefik.yml" ] || die 'docker-compose.traefik.yml não encontrado'
[ -f "$DOMAINS_FILE" ] || die 'docker-compose.dominios.yml não encontrado'
[ -f "$ENV_FILE" ] || die '.env não encontrado'

adquirir_lock
iniciar_heartbeat
log_event deploy_iniciado "services=\"$(sanitizar "${SERVICES[*]}")\" arrombamento=$FORCED_TAKEOVER"
printf 'ENTROU: sessão=%s, PID=%s, deploy=%s.\n' "$SESSION_ID" "$$" "$DEPLOYMENT"

set +e
(
  cd "$PROJECT_DIR"
  docker compose \
    -f docker-compose.prod.yml \
    -f docker-compose.traefik.yml \
    -f "$DOMAINS_FILE" \
    --env-file "$ENV_FILE" \
    up -d "${SERVICES[@]}"
)
compose_rc=$?
set -e
[ "$compose_rc" -eq 0 ] || die "docker compose falhou com código $compose_rc"

MAIN_DOMAIN="$(awk -F= '/^[[:space:]]*DOMAIN[[:space:]]*=/ { sub(/^[^=]*=/, ""); gsub(/^[[:space:]\"'"'"']+|[[:space:]\"'"'"']+$/, ""); print; exit }' "$ENV_FILE")"
[ -n "$MAIN_DOMAIN" ] || die 'DOMAIN não está definido no .env'

mapfile -t CLIENT_DOMAINS < <(
  grep -oE 'Host\(`[^`]+`\)' "$DOMAINS_FILE" \
    | sed -E 's/^Host\(`([^`]+)`\)$/\1/' \
    | sort -u
)
[ "${#CLIENT_DOMAINS[@]}" -gt 0 ] || die 'nenhum domínio de cliente foi encontrado em docker-compose.dominios.yml'
declare -A LAST_CODES=()
BROKEN=()
for ((attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++)); do
  BROKEN=()
  if code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$MAIN_DOMAIN/" 2>/dev/null)"; then
    :
  else
    code='000'
  fi
  LAST_CODES["$MAIN_DOMAIN"]="$code"
  [ "$code" = '307' ] || BROKEN+=("$MAIN_DOMAIN")

  APP_IP="$(
    docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' \
      deskcommcrm-app-1 2>/dev/null | awk 'NF { print; exit }'
  )"
  for domain in "${CLIENT_DOMAINS[@]}"; do
    if [ -n "$APP_IP" ] && code="$(
      curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
        -H "Host: $domain" "http://$APP_IP:3000/" 2>/dev/null
    )"; then
      :
    else
      code='000'
    fi
    LAST_CODES["$domain"]="$code"
    [ "$code" = '307' ] || BROKEN+=("$domain")
  done
  [ "${#BROKEN[@]}" -eq 0 ] && break
  if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
    printf 'Aguardando roteamento: tentativa %s/%s, %s domínio(s) ainda sem 307.\n' \
      "$attempt" "$VERIFY_ATTEMPTS" "${#BROKEN[@]}"
    sleep "$VERIFY_INTERVAL"
  fi
done

if [ "${#BROKEN[@]}" -gt 0 ]; then
  printf 'ERRO: verificação pós-deploy reprovou. Esperado HTTP 307; domínios quebrados:\n' >&2
  for domain in "${BROKEN[@]}"; do
    printf '  - %s: HTTP %s\n' "$domain" "${LAST_CODES[$domain]:-000}" >&2
  done
  # 10 significa que o compose terminou bem e somente a sonda de dominios
  # falhou. O wrapper com rollback pode aplicar sua verificacao mais completa.
  exit 10
fi

printf 'CONFERIDO: domínio principal público e %s host(s) de cliente direto no app responderam HTTP 307.\n' "${#CLIENT_DOMAINS[@]}"
DEPLOY_OK=1
