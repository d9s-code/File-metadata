<#
  Starts the built PRS.exe on an empty data folder and checks it answers —
  the database starts, the schema is created, the API and the frontend are
  served — then stops it. Used by the Windows build workflow.
#>
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Exe = Join-Path $Root "build\standalone\dist\PRS\PRS.exe"
$Data = Join-Path $env:RUNNER_TEMP "prs-smoke"
if (-not $env:RUNNER_TEMP) { $Data = Join-Path $env:TEMP "prs-smoke" }
if (Test-Path $Data) { Remove-Item $Data -Recurse -Force }
$env:PRS_DATA_DIR = $Data
$env:PRS_NO_BROWSER = "1"
$Log = Join-Path $env:TEMP "prs-smoke.log"
$proc = Start-Process -FilePath $Exe -PassThru -RedirectStandardOutput $Log -RedirectStandardError "$Log.err" -WindowStyle Hidden

function Stop-App {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  $pgctl = Join-Path $Root "build\standalone\dist\PRS\pgsql\bin\pg_ctl.exe"
  & $pgctl stop -D (Join-Path $Data "pgdata") -m fast -w 2>$null | Out-Null
}

try {
  $port = $null
  for ($i = 0; $i -lt 120 -and -not $port; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { throw "PRS.exe stopped: $(Get-Content $Log -Raw) $(Get-Content "$Log.err" -Raw)" }
    $marker = Join-Path $Data "running.json"
    if (Test-Path $marker) { $port = (Get-Content $marker -Raw | ConvertFrom-Json).port }
  }
  if (-not $port) { throw "PRS.exe didn't come up in 2 minutes: $(Get-Content $Log -Raw) $(Get-Content "$Log.err" -Raw)" }
  $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health"
  if ($health.database -ne "ok") { throw "Health: $($health | ConvertTo-Json)" }
  $status = Invoke-RestMethod "http://127.0.0.1:$port/api/offline/status"
  if (-not $status.standalone -or $status.set_up) { throw "Status: $($status | ConvertTo-Json)" }
  $page = Invoke-WebRequest "http://127.0.0.1:$port/dashboard" -UseBasicParsing
  if ($page.Content -notmatch "<div id=`"root`">") { throw "The frontend isn't served" }
  Write-Host "PRS.exe works: database, API and frontend on port $port" -ForegroundColor Green
}
finally {
  Stop-App
}
