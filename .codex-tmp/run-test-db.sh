#!/usr/bin/env bash
set -euo pipefail

docker() {
  node .codex-tmp/docker-proxy.mjs "$@"
}

pnpm() {
  corepack pnpm "$@"
}

export -f docker pnpm
export PATH="$(cygpath -u "$PWD/.codex-tmp"):$(cygpath -u "$PWD/node_modules/.bin"):$PATH"
exec bash scripts/test-db.sh
