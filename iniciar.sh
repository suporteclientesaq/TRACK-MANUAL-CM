#!/bin/bash
# Track Manual — iniciador para Linux.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[Track Manual] O Node.js não está instalado. Instale a versão LTS (https://nodejs.org) e rode de novo."
  exit 1
fi
exec node scripts/iniciar.mjs
