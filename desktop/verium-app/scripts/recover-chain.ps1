# One-time recovery for split legacy/unified chain data on Windows.
# Run with the wallet CLOSED:  powershell -ExecutionPolicy Bypass -File scripts\recover-chain.ps1

$ErrorActionPreference = "Stop"
$root = Join-Path $env:APPDATA "Verium"
$verium = Join-Path $root "verium"
$veriumd = Join-Path $env:APPDATA "Vericonomy\desktop-app\run\veriumd.exe"
$conf = Join-Path $root "vericonomy.conf"

Write-Host "=== Verium chain recovery ===" -ForegroundColor Cyan

Write-Host "Stopping veriumd..."
Get-Process veriumd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

$rootBlocks = Join-Path $root "blocks"
$targetBlocks = Join-Path $verium "blocks"
$targetChainstate = Join-Path $verium "chainstate"

function DirSizeMB($path) {
    if (-not (Test-Path $path)) { return 0 }
    return [math]::Round((Get-ChildItem $path -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB, 1)
}

$rootMb = DirSizeMB $rootBlocks
$targetMb = DirSizeMB $targetBlocks
$csMb = DirSizeMB $targetChainstate
Write-Host "Root blocks: $rootMb MB | verium/blocks: $targetMb MB | verium/chainstate: $csMb MB"

if ((Test-Path (Join-Path $rootBlocks "blk00000.dat")) -and ($rootMb -gt $targetMb) -and ($csMb -lt 1)) {
    Write-Host "Promoting legacy blocks into verium\ ..." -ForegroundColor Yellow
    if (Test-Path $targetBlocks) {
        $bak = Join-Path $verium ("blocks.bak-" + (Get-Date -Format "yyyyMMddHHmmss"))
        Move-Item $targetBlocks $bak
        Write-Host "Backed up old verium/blocks to $bak"
    }
    if (Test-Path $targetChainstate) { Remove-Item $targetChainstate -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $verium | Out-Null
    Move-Item $rootBlocks $targetBlocks
    Write-Host "Done. Unified path now has $rootMb MB of block files." -ForegroundColor Green
} else {
    Write-Host "No split-layout promotion needed (or root blocks missing)." -ForegroundColor Gray
}

if (-not (Test-Path $veriumd)) {
    Write-Warning "veriumd not found at $veriumd — start the wallet after recovery."
    exit 0
}

# Read rpc creds from conf
$rpcUser = "verium"
$rpcPass = ""
Get-Content $conf | ForEach-Object {
    if ($_ -match '^\s*rpcuser=(.+)$') { $rpcUser = $matches[1].Trim() }
    if ($_ -match '^\s*rpcpassword=(.+)$') { $rpcPass = $matches[1].Trim() }
}
if (-not $rpcPass) {
    $rpcPass = [guid]::NewGuid().ToString("N")
    Add-Content -Path $conf -Value "rpcpassword=$rpcPass"
    Write-Host "Added new rpcpassword to conf."
}

Write-Host "Starting veriumd with -reindex (leave this window open or run wallet)..." -ForegroundColor Cyan
$args = @(
    "-datadir=$root", "-server=1", "-checklevel=0",
    "-rpcport=33987", "-rpcbind=127.0.0.1", "-rpcallowip=127.0.0.1",
    "-printtoconsole=0", "-dbcache=2048", "-maxconnections=32",
    "-rpcuser=$rpcUser", "-rpcpassword=$rpcPass", "-verium", "-reindex"
)
Start-Process -FilePath $veriumd -ArgumentList $args -WindowStyle Hidden
Start-Sleep -Seconds 5

$pair = "${rpcUser}:${rpcPass}"
$bytes = [Text.Encoding]::ASCII.GetBytes($pair)
$base64 = [Convert]::ToBase64String($bytes)
$body = '{"jsonrpc":"1.0","id":"t","method":"getblockchaininfo","params":[]}'
try {
    $info = Invoke-RestMethod -Uri "http://127.0.0.1:33987/" -Method Post -Body $body -ContentType "application/json" -Headers @{Authorization="Basic $base64"}
    Write-Host "RPC OK — blocks=$($info.result.blocks) headers=$($info.result.headers) ibd=$($info.result.initialblockdownload)" -ForegroundColor Green
}
catch {
    Write-Warning "RPC not ready yet: $($_.Exception.Message). Wait 1-2 min and open the wallet."
}

Write-Host ""
Write-Host "Next: open the Verium wallet. Do NOT click Repair again." -ForegroundColor Cyan
Write-Host "Reindex may take 30-60+ minutes. Mining unlocks once blocks sync." -ForegroundColor Cyan
