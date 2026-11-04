<#
.SYNOPSIS
  Builds the standalone (offline) app for Windows: build\standalone\PRS-offline-<version>-windows-x64.zip

.DESCRIPTION
  Run from anywhere, on Windows 10/11 with Python 3.11, Node 22 and git:

      powershell -ExecutionPolicy Bypass -File standalone\build_windows.ps1

  It builds the frontend for the offline app, freezes the backend and the
  launcher into PRS.exe (PyInstaller), and puts PostgreSQL's Windows binaries
  beside it. Unzip the result anywhere on the PC that will run it and start
  PRS.exe — no installation, no admin rights.

.PARAMETER PgVersion
  The PostgreSQL release to bundle (EnterpriseDB's binaries zip), e.g. 16.9-1.

.PARAMETER PgZip
  A postgresql-<version>-windows-x64-binaries.zip already downloaded — for a
  build machine without internet access.
#>
param(
  [string]$PgVersion = "16.9-1",
  [string]$PgZip = "",
  [string]$Version = ""
)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
$Work = Join-Path $Root "build\standalone"
New-Item -ItemType Directory -Force $Work | Out-Null
if (-not $Version) {
  $Version = (git describe --tags --always 2>$null)
  if (-not $Version) { $Version = "dev" }
}

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }

Step "Frontend (offline build)"
Push-Location frontend
npm ci; Check "npm ci"
npm run build:standalone; Check "Frontend build"
Pop-Location

Step "Python: freezing the app into PRS.exe"
$Venv = Join-Path $Work "venv"
if (-not (Test-Path "$Venv\Scripts\python.exe")) { python -m venv $Venv; Check "Creating the venv" }
& "$Venv\Scripts\python.exe" -m pip install --quiet --upgrade pip; Check "pip upgrade"
& "$Venv\Scripts\python.exe" -m pip install --quiet -r standalone\requirements.txt; Check "pip install"
& "$Venv\Scripts\python.exe" -m PyInstaller standalone\prs.spec --noconfirm --distpath "$Work\dist" --workpath "$Work\pyi"; Check "PyInstaller"

Step "PostgreSQL $PgVersion"
$PgDir = Join-Path $Work "postgresql-$PgVersion"
if (-not (Test-Path "$PgDir\pgsql\bin\pg_ctl.exe")) {
  if (-not $PgZip) {
    $PgZip = Join-Path $Work "postgresql-$PgVersion-windows-x64-binaries.zip"
    if (-not (Test-Path $PgZip)) {
      $Url = "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip"
      Write-Host "Downloading $Url"
      Invoke-WebRequest $Url -OutFile $PgZip
    }
  }
  Expand-Archive $PgZip -DestinationPath $PgDir -Force
}
$App = Join-Path $Work "dist\PRS"
$Pg = Join-Path $App "pgsql"
if (Test-Path $Pg) { Remove-Item $Pg -Recurse -Force }
# Only what runs the server and the tools: not pgAdmin, StackBuilder, headers or docs.
foreach ($d in "bin", "lib", "share") { Copy-Item "$PgDir\pgsql\$d" "$Pg\$d" -Recurse }
Get-ChildItem "$Pg\lib" -Filter *.lib | Remove-Item
if (Test-Path "$Pg\share\doc") { Remove-Item "$Pg\share\doc" -Recurse -Force }
# PostgreSQL needs the Visual C++ runtime; carry it, so the PC needn't have it installed.
foreach ($dll in "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll") {
  $src = Join-Path $env:SystemRoot "System32\$dll"
  if (-not (Test-Path "$Pg\bin\$dll") -and (Test-Path $src)) { Copy-Item $src "$Pg\bin\" }
}
Copy-Item standalone\README-user.txt (Join-Path $App "README.txt")

Step "Zip"
$Zip = Join-Path $Work "PRS-offline-$Version-windows-x64.zip"
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path $App -DestinationPath $Zip
$Size = [math]::Round((Get-Item $Zip).Length / 1MB)
Write-Host "`nBuilt $Zip ($Size MB)" -ForegroundColor Green
