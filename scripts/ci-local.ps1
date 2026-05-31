# Run desktop-app CI locally on Windows (native MSVC wallet + optional WSL sidecars).
param(
  [string]$Target = "x86_64-pc-windows-msvc",
  [ValidateSet("all", "sidecar", "wallet", "wsl-sidecars")]
  [string]$Phase = "wallet",
  [switch]$InstallDeps,
  [switch]$SkipSidecarBuild
)

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppRoot = Join-Path $RepoRoot "desktop\verium-app"
$drive = $RepoRoot.Substring(0, 1).ToLower()
$WslRoot = "/mnt/$drive" + ($RepoRoot.Substring(2) -replace '\\', '/')

function Invoke-WslSidecar {
  param([string]$WslTarget, [switch]$Install)
  $argsList = @("--target", $WslTarget, "--phase", "sidecar")
  if ($Install) { $argsList += "--install-deps" }
  $outExe = "$WslRoot/out/veriumd-$WslTarget"
  if ($WslTarget -match "windows") { $outExe += ".exe" }
  $skip = wsl bash -lc "test -f '$outExe' && echo yes || echo no"
  if ($skip.Trim() -eq "yes") {
    Write-Host "[skip] sidecar exists: $outExe"
    return $true
  }
  $dep = wsl bash -lc "case '$WslTarget' in *linux*) h=x86_64-linux-gnu;; *aarch64*) h=aarch64-linux-gnu;; *windows*) h=x86_64-w64-mingw32;; esac; test -f '$WslRoot/depends/'`$h'/share/config.site' && echo yes || echo no"
  if ($dep.Trim() -eq "yes") { $argsList += "--skip-depends" }
  wsl bash -lc "cd '$WslRoot' && sed -i 's/\r$//' scripts/ci-local.sh scripts/ci-local-all.sh && chmod +x scripts/ci-local.sh scripts/ci-local-all.sh && ./scripts/ci-local.sh $($argsList -join ' ')"
}

function Stage-SidecarForWallet {
  $binDir = Join-Path $AppRoot "src-tauri\binaries"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $winOut = Join-Path $RepoRoot "out\veriumd-$Target.exe"
  $dest = Join-Path $binDir "veriumd-$Target.exe"
  if (Test-Path $winOut) {
    Copy-Item -Force $winOut $dest
    Write-Host "Staged sidecar: $dest"
    return
  }
  Write-Warning "MinGW sidecar not found at $winOut — run: .\scripts\ci-local.ps1 -Phase wsl-sidecars"
}

function Build-Wallet {
  Push-Location $AppRoot
  try {
    npm ci 2>$null; if ($LASTEXITCODE -ne 0) { npm install }
    npm run lint
    npm test
    npm run build
    Stage-SidecarForWallet
    $env:VERIUMD_TARGET_TRIPLE = $Target
    $env:VERIUMD_SKIP_IF_PRESENT = "1"
    npm run fetch:veriumd
    $env:VERICOIND_TARGET_TRIPLE = $Target
    $env:VERICOIND_REQUIRED = "0"
    npm run fetch:vericoind
    cargo check --manifest-path src-tauri/Cargo.toml --target $Target
    cargo test --manifest-path src-tauri/Cargo.toml --target $Target
    & (Join-Path $AppRoot "scripts\tauri-build.ps1")
  } finally {
    Pop-Location
  }
}

switch ($Phase) {
  "wsl-sidecars" {
    Invoke-WslSidecar "x86_64-unknown-linux-gnu" -Install:$InstallDeps
    Invoke-WslSidecar "aarch64-unknown-linux-gnu" -Install:$InstallDeps
    Invoke-WslSidecar "x86_64-pc-windows-msvc" -Install:$InstallDeps
  }
  "sidecar" {
    Invoke-WslSidecar "x86_64-pc-windows-msvc" -Install:$InstallDeps
  }
  "wallet" {
    if (-not $SkipSidecarBuild) {
      Invoke-WslSidecar "x86_64-pc-windows-msvc" -Install:$InstallDeps
    }
    Build-Wallet
  }
  "all" {
    wsl bash -lc "cd '$WslRoot' && chmod +x scripts/ci-local-all.sh && ./scripts/ci-local-all.sh --sidecars-only $(if ($InstallDeps) { '--install-deps' })"
    Build-Wallet
  }
}
