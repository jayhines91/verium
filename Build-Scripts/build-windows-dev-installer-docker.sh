#!/bin/bash
# Alias for the canonical dev recompile script.
exec "$(dirname "$0")/build-windows-dev-docker.sh" "$@"
