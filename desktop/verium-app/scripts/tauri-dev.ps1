# Load MSVC + Rust into PATH, then run `tauri dev`.
# Use when regular PowerShell/Cursor terminal cannot find cargo or link.exe.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

. (Join-Path $PSScriptRoot "load-win-build-env.ps1")

npm run fetch:sidecars:if-missing
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run tauri:dev:raw
