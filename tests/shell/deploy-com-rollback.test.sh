#!/usr/bin/env bash
# Testes do deploy com rollback. Docker, curl, ssh e o porteiro são dublês;
# nenhum caso conecta na VPS ou sobe contêiner real.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy-com-rollback.sh"
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

mkdir -p "$WORK/bin" "$WORK/project/scripts"
cp "$ROOT/docker-compose.dominios.yml" "$WORK/project/docker-compose.dominios.yml"

cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_DOCKER_CALLS"
case "${1:-}" in
  inspect)
    if [[ "$*" == *NetworkSettings.Networks* ]]; then
      printf '172.19.0.8\n'
    else
      printf 'healthy\n'
    fi
    ;;
  logs)
    exit 0
    ;;
  *)
    printf 'docker inesperado: %s\n' "$*" >&2
    exit 90
    ;;
esac
STUB
chmod +x "$WORK/bin/docker"

cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CURL_CALLS"
out=/dev/null
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -w|--max-time|-H)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

if [[ "$url" == */api/v1/health ]]; then
  current_tag="$(sed -n 's#^APP_IMAGE=.*:##p' "$FAKE_ENV_FILE")"
  status=healthy
  version="$current_tag"
  code=200
  if [ "${FAKE_HEALTH_MODE:-healthy}" = unhealthy-new ] && [ "$current_tag" = "$FAKE_NEW_TAG" ]; then
    status=unhealthy
    code=503
  fi
  if [ "${FAKE_HEALTH_MODE:-healthy}" = wrong-version-new ] && [ "$current_tag" = "$FAKE_NEW_TAG" ]; then
    version=versao-antiga-no-container
  fi
  printf '{"data":{"status":"%s","version":"%s"}}\n' "$status" "$version" > "$out"
  printf '%s' "$code"
  exit 0
fi

printf '307'
STUB
chmod +x "$WORK/bin/curl"

cat > "$WORK/bin/ssh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_SSH_CALLS"
exit 99
STUB
chmod +x "$WORK/bin/ssh"

cat > "$WORK/project/scripts/deploy-producao.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_GATE_CALLS"
tag=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      tag="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [ "$tag" = "$FAKE_OLD_TAG" ] && [ "${FAKE_ROLLBACK_GATE_FAIL:-0}" = 1 ]; then
  exit 42
fi
if [ "$tag" = "$FAKE_NEW_TAG" ]; then
  exit "${FAKE_INITIAL_GATE_RC:-0}"
fi
exit 0
STUB
chmod +x "$WORK/project/scripts/deploy-producao.sh"

export PATH="$WORK/bin:$PATH"
export DEPLOY_PROJECT_DIR="$WORK/project"
export DEPLOY_ENV_FILE="$WORK/project/.env"
export DEPLOY_DOMAINS_FILE="$WORK/project/docker-compose.dominios.yml"
export DEPLOY_GATE_SCRIPT="$WORK/project/scripts/deploy-producao.sh"
export DEPLOY_ROLLBACK_VERIFY_ATTEMPTS=1
export DEPLOY_ROLLBACK_VERIFY_INTERVAL_SECONDS=0
export FAKE_ENV_FILE="$DEPLOY_ENV_FILE"
export FAKE_OLD_TAG='1.6.0-veritas.8'
export FAKE_NEW_TAG='1.6.0-veritas.9'
export FAKE_DOCKER_CALLS="$WORK/docker.calls"
export FAKE_CURL_CALLS="$WORK/curl.calls"
export FAKE_SSH_CALLS="$WORK/ssh.calls"
export FAKE_GATE_CALLS="$WORK/gate.calls"

env_valido() {
  cat > "$DEPLOY_ENV_FILE" <<EOF
DOMAIN=crm.agenciaveritasdigital.com
APP_IMAGE=ghcr.io/enediscremim95/deskcommcrm:$FAKE_OLD_TAG
WORKER_IMAGE=ghcr.io/enediscremim95/deskcomm-worker:$FAKE_OLD_TAG
SCHEDULER_IMAGE=ghcr.io/enediscremim95/deskcomm-scheduler:$FAKE_OLD_TAG
OUTRA_CONFIG=preservada
EOF
}

novo_caso() {
  local name="$1"
  export DEPLOY_LOG_FILE="$WORK/$name.log"
  rm -f "$DEPLOY_LOG_FILE" "$FAKE_DOCKER_CALLS" "$FAKE_CURL_CALLS" "$FAKE_SSH_CALLS" "$FAKE_GATE_CALLS"
  rm -f "$DEPLOY_ENV_FILE".bak-antes-*
  unset FAKE_ROLLBACK_GATE_FAIL FAKE_INITIAL_GATE_RC FAKE_HEALTH_MODE
  env_valido
}

printf '\n▶ sucesso sem rollback\n'
novo_caso sucesso
FAKE_INITIAL_GATE_RC=10 FAKE_HEALTH_MODE=healthy \
  bash "$SCRIPT" --session teste-sucesso --tag "$FAKE_NEW_TAG" > "$WORK/sucesso.out" 2>&1
rc=$?
check 'sai 0 mesmo quando a sonda antiga do porteiro sai 10' test "$rc" -eq 0
check 'as três imagens ficam na nova tag' test "$(grep -c ":$FAKE_NEW_TAG$" "$DEPLOY_ENV_FILE")" -eq 3
check 'o backup guarda a tag anterior' test "$(grep -c ":$FAKE_OLD_TAG$" "$DEPLOY_ENV_FILE.bak-antes-$FAKE_NEW_TAG")" -eq 3
check 'o porteiro recebeu somente um deploy' test "$(wc -l < "$FAKE_GATE_CALLS")" -eq 1
check 'o porteiro recebeu os três serviços' grep -q -- '--service app --service worker --service scheduler' "$FAKE_GATE_CALLS"
check 'o sucesso foi registrado' grep -q 'event=deploy_com_rollback.*status=sucesso' "$DEPLOY_LOG_FILE"
check 'não houve rollback' bash -c '! grep -q "event=rollback" "$1"' _ "$DEPLOY_LOG_FILE"
check 'o domínio principal foi conferido publicamente' grep -q 'https://crm.agenciaveritasdigital.com/' "$FAKE_CURL_CALLS"
for cliente in crm.imobiliariaa.com.br crm.zaparolliimoveis.com crm.lecote.com.br crm.alavancagem.site crm-imobiliariaa.agenciaveritasdigital.com; do
  check "$cliente foi conferido direto no app" grep -q -- "-H Host: $cliente http://172.19.0.8:3000/" "$FAKE_CURL_CALLS"
done
check 'nenhum ssh real ou dublê foi necessário' test ! -s "$FAKE_SSH_CALLS"

printf '\n▶ health falha e volta sozinho\n'
novo_caso health-falha
FAKE_HEALTH_MODE=unhealthy-new \
  bash "$SCRIPT" --session teste-health --tag "$FAKE_NEW_TAG" > "$WORK/health.out" 2>&1
rc=$?
check 'falha de health termina em 20 após rollback' test "$rc" -eq 20
check 'o .env volta à tag anterior' test "$(grep -c ":$FAKE_OLD_TAG$" "$DEPLOY_ENV_FILE")" -eq 3
check 'o porteiro foi chamado para ida e volta' test "$(wc -l < "$FAKE_GATE_CALLS")" -eq 2
check 'o rollback foi registrado como sucesso' grep -q 'event=rollback.*status=sucesso.*health HTTP 503' "$DEPLOY_LOG_FILE"

printf '\n▶ versão errada no health volta sozinho\n'
novo_caso versao-errada
FAKE_HEALTH_MODE=wrong-version-new \
  bash "$SCRIPT" --session teste-versao --tag "$FAKE_NEW_TAG" > "$WORK/versao.out" 2>&1
rc=$?
check 'versão divergente termina em 20 após rollback' test "$rc" -eq 20
check 'o motivo registra a versão divergente' grep -q 'health não reportou a versão' "$DEPLOY_LOG_FILE"
check 'a versão anterior volta ao .env' test "$(grep -c ":$FAKE_OLD_TAG$" "$DEPLOY_ENV_FILE")" -eq 3

printf '\n▶ falha do próprio rollback\n'
novo_caso rollback-falha
FAKE_HEALTH_MODE=unhealthy-new FAKE_ROLLBACK_GATE_FAIL=1 \
  bash "$SCRIPT" --session teste-rollback --tag "$FAKE_NEW_TAG" > "$WORK/rollback.out" 2>&1
rc=$?
check 'rollback quebrado termina em 30' test "$rc" -eq 30
check 'a saída destaca a falha e a ação manual' grep -q 'ROLLBACK FALHOU' "$WORK/rollback.out"
check 'a saída manda restaurar pelo backup' grep -q 'Restaure as três imagens pelo backup' "$WORK/rollback.out"
check 'a falha do rollback entra no livro' grep -q 'event=rollback.*status=falha.*código 42' "$DEPLOY_LOG_FILE"

printf '\n▶ .env inválido aborta sem tocar\n'
novo_caso env-invalido
sed -i 's#^WORKER_IMAGE=.*#WORKER_IMAGE=docker.io/outro/worker:tag-invalida#' "$DEPLOY_ENV_FILE"
cp "$DEPLOY_ENV_FILE" "$WORK/env-invalido.original"
bash "$SCRIPT" --session teste-env --tag "$FAKE_NEW_TAG" > "$WORK/env-invalido.out" 2>&1
rc=$?
check '.env inválido aborta com erro comum' test "$rc" -eq 1
check 'o .env inválido permanece byte a byte igual' cmp -s "$DEPLOY_ENV_FILE" "$WORK/env-invalido.original"
check 'nenhum backup foi criado' bash -c '! compgen -G "$1.bak-antes-*" >/dev/null' _ "$DEPLOY_ENV_FILE"
check 'o porteiro não foi chamado' test ! -s "$FAKE_GATE_CALLS"
check 'docker não foi chamado' test ! -s "$FAKE_DOCKER_CALLS"
check 'curl não foi chamado' test ! -s "$FAKE_CURL_CALLS"
check 'ssh não foi chamado' test ! -s "$FAKE_SSH_CALLS"

printf '\n'
if [ "$FAILS" -gt 0 ]; then
  printf '✗ %d falha(s)\n' "$FAILS"
  exit 1
fi
printf '✓ deploy com rollback: tudo verde\n'
