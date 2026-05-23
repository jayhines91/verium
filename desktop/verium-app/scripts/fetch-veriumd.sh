#!/usr/bin/env bash
# Bash wrapper around scripts/fetch-veriumd.cjs.
# Honors the same environment variables; see the .cjs file for documentation.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/fetch-veriumd.cjs" "$@"
