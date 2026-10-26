#!/bin/sh
# Traverse checkout-based launcher setup. No shell profiles or global tools are changed.
set -eu
chosen_node=node
expect_node=false
for argument do
  if [ "$expect_node" = true ]; then chosen_node=$argument; expect_node=false
  elif [ "$argument" = --node ]; then expect_node=true
  fi
done
if [ "$expect_node" = true ]; then printf '%s\n' 'Traverse install: --node requires an executable path' >&2; exit 1; fi
if ! command -v "$chosen_node" >/dev/null 2>&1; then printf '%s\n' 'Traverse install: Node is missing; supply --node /absolute/path/to/node' >&2; exit 1; fi
checkout=$(CDPATH='' cd -P "$(dirname "$0")" && pwd)
exec "$chosen_node" "$checkout/bin/install.mjs" "$@"
