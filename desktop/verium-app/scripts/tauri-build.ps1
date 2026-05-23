# Load MSVC + Rust into PATH, then run `tauri build`.
# Use when regular PowerShell/Cursor terminal cannot find cargo or link.exe.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

. (Join-Path $PSScriptRoot "load-win-build-env.ps1")

npx tauri build
