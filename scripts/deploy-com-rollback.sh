#!/usr/bin/env bash
# Deploy das imagens app, worker e scheduler com volta automática.
#
# Migration é responsabilidade de uma etapa anterior: deve ser aditiva e estar
# aplicada ANTES deste script. Rollback de imagem não desfaz migration nem toca
# banco, volume, WAHA, Redis, Traefik, n8n ou Hermes.
set -Eeuo pipefail

PROJECT_DIR="${DEPLOY_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${DEPLOY_ENV_FILE:-$PROJECT_DIR/.env}"
DOMAINS_FILE="${DEPLOY_DOMAINS_FILE:-$PROJECT_DIR/docker-compose.dominios.yml}"
GATE_SCRIPT="${DEPLOY_GATE_SCRIPT:-$PROJECT_DIR/scripts/deploy-producao.sh}"
LOG_FILE="${DEPLOY_LOG_FILE:-/var/log/deskcommcrm/deploy.log}"
APP_CONTAINER="${DEPLOY_APP_CONTAINER:-deskcommcrm-app-1}"
WORKER_CONTAINER="${DEPLOY_WORKER_CONTAINER:-deskcommcrm-worker-1}"
SCHEDULER_CONTAINER="${DEPLOY_SCHEDULER_CONTAINER:-deskcommcrm-scheduler-1}"
VERIFY_ATTEMPTS="${DEPLOY_ROLLBACK_VERIFY_ATTEMPTS:-24}"
VERIFY_INTERVAL="${DEPLOY_ROLLBACK_VERIFY_INTERVAL_SECONDS:-5}"

SESSION_ID=""
NEW_TAG=""
PREVIOUS_TAG=""
BACKUP_FILE=""
LAST_REASON=""
ENV_MUTATED=0
ROLLBACK_ACTIVE=0
COMPLETED=0

usage() {
  cat <<'USAGE'
Uso:
  bash scripts/deploy-com-rollback.sh --session <id> --tag <nova-tag>

O script troca somente a tag de APP_IMAGE, WORKER_IMAGE e SCHEDULER_IMAGE,
chama o porteiro para os três serviços e volta sozinho à tag anterior se a
verificação reprovar.
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
  printf 'timestamp=%s event=%s session="%s" new_tag="%s" previous_tag="%s" %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" "$(sanitizar "$SESSION_ID")" \
    "$(sanitizar "$NEW_TAG")" "$(sanitizar "$PREVIOUS_TAG")" "$*" >> "$LOG_FILE"
}

ler_tag_imagem() {
  local key="$1" count line
  count="$(grep -Ec "^${key}=" "$ENV_FILE" || true)"
  [ "$count" -eq 1 ] || return 1
  line="$(grep -E "^${key}=" "$ENV_FILE")"
  if [[ "$line" =~ ^${key}=ghcr\.io/enediscremim95/[A-Za-z0-9._-]+:([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

reescrever_tag() {
  local tag="$1" tmp="${ENV_FILE}.tmp.$$"
  awk -v tag="$tag" '
    /^APP_IMAGE=/       { sub(/:[^:[:space:]]+$/, ":" tag); app++ }
    /^WORKER_IMAGE=/    { sub(/:[^:[:space:]]+$/, ":" tag); worker++ }
    /^SCHEDULER_IMAGE=/ { sub(/:[^:[:space:]]+$/, ":" tag); scheduler++ }
    { print }
    END { if (app != 1 || worker != 1 || scheduler != 1) exit 42 }
  ' "$ENV_FILE" > "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  chmod --reference="$ENV_FILE" "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$ENV_FILE"
}

chamar_porteiro() {
  local session="$1" tag="$2"
  bash "$GATE_SCRIPT" \
    --session "$session" \
    --tag "$tag" \
    --service app \
    --service worker \
    --service scheduler
}

ip_do_app() {
  docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' \
    "$APP_CONTAINER" 2>/dev/null | awk 'NF { print; exit }'
}

codigo_http() {
  local url="$1"
  shift
  curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$@" "$url" 2>/dev/null || printf '000'
}

health_confere() {
  local app_ip="$1" expected_tag="$2" body_file code compact
  body_file="$(mktemp)"
  if ! code="$(
    curl -sS --max-time 15 -o "$body_file" -w '%{http_code}' \
      "http://$app_ip:3000/api/v1/health" 2>/dev/null
  )"; then
    code='000'
  fi
  if [ "$code" != '200' ]; then
    LAST_REASON="health HTTP $code"
    rm -f "$body_file"
    return 1
  fi
  compact="$(tr -d '\r\n\t ' < "$body_file")"
  rm -f "$body_file"
  if [[ "$compact" != *'"status":"healthy"'* ]]; then
    LAST_REASON='health sem status healthy'
    return 1
  fi
  if [[ "$compact" != *"\"version\":\"$expected_tag\""* ]]; then
    LAST_REASON="health não reportou a versão $expected_tag"
    return 1
  fi
}

containers_conferem() {
  local container status
  for container in "$APP_CONTAINER" "$WORKER_CONTAINER" "$SCHEDULER_CONTAINER"; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [ "$status" != 'healthy' ]; then
      LAST_REASON="contêiner $container está ${status:-sem health}"
      return 1
    fi
  done
}

logs_conferem() {
  local container logs_file
  for container in "$APP_CONTAINER" "$WORKER_CONTAINER"; do
    logs_file="$(mktemp)"
    if ! docker logs --since 3m "$container" > "$logs_file" 2>&1; then
      LAST_REASON="não foi possível ler os logs de $container"
      rm -f "$logs_file"
      return 1
    fi
    if grep -F '"level":"error"' "$logs_file" | grep -Eiq 'PGRST|ECONNREFUSED|unhandled'; then
      LAST_REASON="erro crítico recente nos logs de $container"
      rm -f "$logs_file"
      return 1
    fi
    rm -f "$logs_file"
  done
}

rotas_conferem() {
  local app_ip="$1" main_domain code domain
  local -a client_domains=()
  main_domain="$(awk -F= '/^[[:space:]]*DOMAIN[[:space:]]*=/ { sub(/^[^=]*=/, ""); gsub(/^[[:space:]"'"'"']+|[[:space:]"'"'"']+$/, ""); print; exit }' "$ENV_FILE")"
  [ -n "$main_domain" ] || {
    LAST_REASON='DOMAIN não está definido no .env'
    return 1
  }

  code="$(codigo_http "https://$main_domain/")"
  if [ "$code" != '307' ]; then
    LAST_REASON="domínio principal $main_domain respondeu HTTP $code"
    return 1
  fi

  mapfile -t client_domains < <(
    grep -oE 'Host\(`[^`]+`\)' "$DOMAINS_FILE" \
      | sed -E 's/^Host\(`([^`]+)`\)$/\1/' \
      | sort -u
  )
  [ "${#client_domains[@]}" -gt 0 ] || {
    LAST_REASON='nenhum host de cliente foi encontrado no compose de domínios'
    return 1
  }
  for domain in "${client_domains[@]}"; do
    code="$(codigo_http "http://$app_ip:3000/" -H "Host: $domain")"
    if [ "$code" != '307' ]; then
      LAST_REASON="host $domain direto no app respondeu HTTP $code"
      return 1
    fi
  done
}

verificar_estado() {
  local expected_tag="$1" check_logs="$2" attempt app_ip
  for ((attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++)); do
    LAST_REASON=''
    app_ip="$(ip_do_app || true)"
    if [ -z "$app_ip" ]; then
      LAST_REASON="IP do contêiner $APP_CONTAINER indisponível"
    elif ! health_confere "$app_ip" "$expected_tag"; then
      :
    elif ! rotas_conferem "$app_ip"; then
      :
    elif ! containers_conferem; then
      :
    elif [ "$check_logs" = '1' ] && ! logs_conferem; then
      :
    else
      return 0
    fi

    if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
      printf 'Aguardando verificação: tentativa %s/%s, motivo: %s.\n' \
        "$attempt" "$VERIFY_ATTEMPTS" "$LAST_REASON"
      sleep "$VERIFY_INTERVAL"
    fi
  done
  return 1
}

rollback_e_sair() {
  local reason="$1" gate_rc=0 rollback_reason
  ROLLBACK_ACTIVE=1
  printf 'FALHA: %s. Iniciando rollback para %s.\n' "$reason" "$PREVIOUS_TAG" >&2
  if ! reescrever_tag "$PREVIOUS_TAG"; then
    rollback_reason='não foi possível restaurar as imagens no .env'
    log_event rollback "status=falha reason=\"$(sanitizar "$reason")\" rollback_reason=\"$(sanitizar "$rollback_reason")\""
    printf '\n*** ROLLBACK FALHOU ***\n%s\nRestaure as três imagens pelo backup %s e rode o porteiro manualmente.\n' \
      "$rollback_reason" "$BACKUP_FILE" >&2
    exit 30
  fi

  set +e
  chamar_porteiro "${SESSION_ID}-rollback" "$PREVIOUS_TAG"
  gate_rc=$?
  set -e
  if [ "$gate_rc" -ne 0 ] && [ "$gate_rc" -ne 10 ]; then
    rollback_reason="porteiro do rollback saiu com código $gate_rc"
  elif ! verificar_estado "$PREVIOUS_TAG" 0; then
    rollback_reason="$LAST_REASON"
  else
    log_event rollback "status=sucesso reason=\"$(sanitizar "$reason")\""
    printf 'ROLLBACK CONFERIDO: imagens restauradas para %s.\n' "$PREVIOUS_TAG" >&2
    exit 20
  fi

  log_event rollback "status=falha reason=\"$(sanitizar "$reason")\" rollback_reason=\"$(sanitizar "$rollback_reason")\""
  printf '\n*** ROLLBACK FALHOU ***\n%s\nRestaure as três imagens pelo backup %s e rode o porteiro manualmente.\n' \
    "$rollback_reason" "$BACKUP_FILE" >&2
  exit 30
}

ao_sair() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ "$ENV_MUTATED" -eq 1 ] && [ "$COMPLETED" -eq 0 ] && [ "$ROLLBACK_ACTIVE" -eq 0 ]; then
    set +e
    rollback_e_sair "erro inesperado do wrapper, código $rc"
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
    --tag)
      [ "$#" -ge 2 ] || die '--tag exige um valor'
      NEW_TAG="$2"
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
[ -n "$NEW_TAG" ] || die 'informe --tag com a nova tag das três imagens'
[[ "$NEW_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'a tag deve conter apenas letras, números, ponto, sublinhado e hífen'
[ -f "$ENV_FILE" ] || die '.env não encontrado'
[ -f "$DOMAINS_FILE" ] || die 'docker-compose.dominios.yml não encontrado'
[ -f "$GATE_SCRIPT" ] || die 'scripts/deploy-producao.sh não encontrado'
[[ "$VERIFY_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die 'DEPLOY_ROLLBACK_VERIFY_ATTEMPTS deve ser inteiro positivo'
[[ "$VERIFY_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die 'DEPLOY_ROLLBACK_VERIFY_INTERVAL_SECONDS deve ser número não negativo'

app_tag="$(ler_tag_imagem APP_IMAGE)" || die 'APP_IMAGE ausente, duplicada ou fora do formato ghcr.io/enediscremim95/<imagem>:<tag>'
worker_tag="$(ler_tag_imagem WORKER_IMAGE)" || die 'WORKER_IMAGE ausente, duplicada ou fora do formato ghcr.io/enediscremim95/<imagem>:<tag>'
scheduler_tag="$(ler_tag_imagem SCHEDULER_IMAGE)" || die 'SCHEDULER_IMAGE ausente, duplicada ou fora do formato ghcr.io/enediscremim95/<imagem>:<tag>'
[ "$app_tag" = "$worker_tag" ] && [ "$app_tag" = "$scheduler_tag" ] || \
  die 'APP_IMAGE, WORKER_IMAGE e SCHEDULER_IMAGE não estão na mesma tag; nada foi alterado'
PREVIOUS_TAG="$app_tag"
BACKUP_FILE="${ENV_FILE}.bak-antes-${NEW_TAG}"

cp -p -- "$ENV_FILE" "$BACKUP_FILE" || die "não foi possível criar o backup $BACKUP_FILE"
ENV_MUTATED=1
reescrever_tag "$NEW_TAG" || die 'não foi possível trocar as três tags no .env'

set +e
chamar_porteiro "$SESSION_ID" "$NEW_TAG"
gate_rc=$?
set -e
if [ "$gate_rc" -ne 0 ] && [ "$gate_rc" -ne 10 ]; then
  rollback_e_sair "porteiro saiu com código $gate_rc"
fi

if ! verificar_estado "$NEW_TAG" 1; then
  rollback_e_sair "$LAST_REASON"
fi

log_event deploy_com_rollback "status=sucesso backup=\"$(sanitizar "$BACKUP_FILE")\""
COMPLETED=1
printf 'DEPLOY CONFERIDO: %s em app, worker e scheduler; backup em %s.\n' "$NEW_TAG" "$BACKUP_FILE"
exit 0
