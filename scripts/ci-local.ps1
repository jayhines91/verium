# Run desktop-app CI locally from Windows via WSL (Linux targets).
param(
  [string]$Target = "x86_64-unknown-linux-gnu",
  [ValidateSet("all", "sidecar", "wallet")]
  [string]$Phase = "all",
  [switch]$InstallDeps
)

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$drive = $RepoRoot.Substring(0, 1).ToLower()
$WslRoot = "/mnt/$drive" + ($RepoRoot.Substring(2) -replace '\\', '/')

$argsList = @("--target", $Target, "--phase", $Phase)
if ($InstallDeps) { $argsList += "--install-deps" }

Write-Host "WSL: bash $WslRoot/scripts/ci-local.sh $($argsList -join ' ')"
wsl bash -lc "cd '$WslRoot' && sed -i 's/\r$//' scripts/ci-local.sh && chmod +x scripts/ci-local.sh && ./scripts/ci-local.sh $($argsList -join ' ')"
