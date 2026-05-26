#!/bin/bash
# Preseed depends for Verium 2.2 — delegates to shared monorepo preseed.
exec "$(cd "$(dirname "$0")/../.." && pwd)/shared/depends-preseed/preseed-depends.sh" \
  "$(cd "$(dirname "$0")/.." && pwd)" "$@"
