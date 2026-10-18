#!/bin/sh
# Run the same bounded, read-only probe from the user's normal Terminal.
set -eu
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  probe_node="$(command -v node)"
else
  probe_node="/Users/vlad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$probe_node" ]; then
  echo "Node.js не знайдений. Встановіть Node.js і повторіть тест."
  exit 1
fi
"$probe_node" scripts/probe-codex-sdk.mjs "${1:-text}"
