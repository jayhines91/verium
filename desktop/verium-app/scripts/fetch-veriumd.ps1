# PowerShell wrapper around scripts/fetch-veriumd.cjs.
# Honors the same environment variables; see the .cjs file for documentation.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot "fetch-veriumd.cjs"
& node $script $args
exit $LASTEXITCODE
