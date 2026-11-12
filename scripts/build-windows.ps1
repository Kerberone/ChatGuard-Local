$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw 'Go 1.23+ non trovato. Installa Go da https://go.dev/dl/' }
  $env:GOOS='windows'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
  go build -trimpath -ldflags='-s -w' -o 'host/ChatGuardLocalHost.exe' ./host
  if ($LASTEXITCODE -ne 0) { throw 'Compilazione non riuscita' }
  Get-FileHash -Algorithm SHA256 'host/ChatGuardLocalHost.exe'
} finally { Pop-Location }
