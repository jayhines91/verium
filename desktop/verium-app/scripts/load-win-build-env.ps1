# Load MSVC + Rust into PATH for Tauri builds on Windows.
# Dot-source from tauri-dev.ps1 / tauri-build.ps1.

$ErrorActionPreference = "Stop"

function Find-VsInstallRoot {
    $candidates = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

$vsRoot = Find-VsInstallRoot
$vcvarsAll = if ($vsRoot) {
    Join-Path $vsRoot "VC\Auxiliary\Build\vcvarsall.bat"
} else { $null }
$vcvars64 = if ($vsRoot) {
    Join-Path $vsRoot "VC\Auxiliary\Build\vcvars64.bat"
} else { $null }

if (-not $vsRoot -or -not (Test-Path $vcvars64)) {
    Write-Host ""
    Write-Host "ERROR: Visual Studio C++ build tools not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install one of:"
    Write-Host "  winget install Microsoft.VisualStudio.2022.BuildTools"
    Write-Host "  (then in Visual Studio Installer, add 'Desktop development with C++')"
    Write-Host ""
    Write-Host "Or open Start -> 'Developer PowerShell for VS 2022' and run:"
    Write-Host "  npm run tauri:build"
    Write-Host ""
    exit 1
}

if (-not (Test-Path $vcvarsAll)) {
    Write-Host ""
    Write-Host "ERROR: Incomplete Visual Studio C++ installation." -ForegroundColor Red
    Write-Host "Found: $vsRoot"
    Write-Host "Missing: VC\Auxiliary\Build\vcvarsall.bat"
    Write-Host ""
    exit 1
}

Write-Host "Loading MSVC environment from:" -ForegroundColor Cyan
Write-Host "  $vcvarsAll x64"

cmd /c "`"$vcvarsAll`" x64 && set" | ForEach-Object {
    if ($_ -match '^(.*?)=(.*)$') {
        Set-Item -Path "env:$($matches[1])" -Value $matches[2]
    }
}

$link = Get-Command link.exe -ErrorAction SilentlyContinue
if (-not $link) {
    Write-Host ""
    Write-Host "ERROR: link.exe still not on PATH after loading vcvarsall x64." -ForegroundColor Red
    Write-Host "Repair the 'Desktop development with C++' workload in Visual Studio Installer."
    Write-Host ""
    exit 1
}

Write-Host "Using linker: $($link.Source)" -ForegroundColor Green

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
    if ($env:PATH -notlike "*$cargoBin*") {
        $env:PATH = "$cargoBin;$env:PATH"
    }
    Write-Host "Using cargo: $(Join-Path $cargoBin 'cargo.exe')" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "ERROR: cargo not found at $cargoBin" -ForegroundColor Red
    Write-Host "Install Rust from https://rustup.rs/ then restart the terminal."
    Write-Host ""
    exit 1
}

Write-Host ""
