#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  app_node="$(command -v node)"
else
  app_node="/Users/vlad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$app_node" ]; then
  echo "Потрібен Node.js. Встановіть Node.js і повторіть запуск."
  exit 1
fi
exec "$app_node" server/index.mjs
