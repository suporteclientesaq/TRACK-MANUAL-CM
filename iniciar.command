#!/bin/bash
# Track Manual — iniciador para Mac. Dois cliques neste arquivo abrem o painel.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  # O Node instalado pelo site costuma ficar aqui e nem sempre está no PATH do Finder.
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[Track Manual] O Node.js não está instalado."
  echo "Baixe a versão LTS em https://nodejs.org , instale e abra este arquivo de novo."
  echo
  read -n 1 -s -r -p "Aperte qualquer tecla para fechar."
  exit 1
fi
node scripts/iniciar.mjs
