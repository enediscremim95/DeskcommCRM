#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

fail=0
check() {
  local nome="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ✓ %s\n' "$nome"
  else printf '  ✗ %s\n' "$nome"; fail=1; fi
}

echo "vigia: independente do app e do banco para entregar o alerta"
check "imagem do scheduler tem Node 22" grep -q '^FROM node:22-alpine' Dockerfile.scheduler
check "artefato da vigia entra na imagem publicada" \
  grep -q 'COPY lib/channels/vigia-independente.mjs' Dockerfile.scheduler
check "serviço principal existe" grep -q '^  vigia:$' docker-compose.prod.yml
check "watchdog companheiro existe" grep -q '^  vigia-watchdog:$' docker-compose.prod.yml
check "aviso usa o endereço interno do transporte, não a rota do app" \
  grep -q 'WAHA_API_BASE_URL: http://waha:3000' docker-compose.prod.yml
check "estado sobrevive ao restart" grep -q 'vigia-state:/state' docker-compose.prod.yml

echo "mídia: números derivados estão no artefato instalado"
check "retenção padrão é 21 dias" grep -q 'WHATSAPP_MEDIA_RETENTION_DAYS:-21' docker-compose.prod.yml
check "aviso padrão é 2,37 GB" grep -q 'WHATSAPP_MEDIA_STORAGE_ALERT_BYTES:-2370000000' docker-compose.prod.yml
check "teto padrão é 3,15 GB" grep -q 'WHATSAPP_MEDIA_STORAGE_CAP_BYTES:-3150000000' docker-compose.prod.yml
check "cron de expurgo está agendado" grep -q 'api/v1/cron/media-retention' docker/scheduler/entrypoint.sh

if [ "$fail" -eq 0 ]; then
echo "OK — vigia e teto chegam ao self-host."
else
  echo "FALHOU."
fi
exit "$fail"
