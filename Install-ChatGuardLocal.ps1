# ChatGuard Local v1.0.0 public installer — current user only, no administrator required.
# Registry keys: HKCU Brave and Chrome NativeMessagingHosts. Does not change Brave's download settings.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$hostName = 'com.chatguard.local'
$sourceExe = Join-Path $PSScriptRoot 'host\ChatGuardLocalHost.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'ChatGuardLocal'
$targetExe = Join-Path $installDir 'ChatGuardLocalHost.exe'
$manifestFile = Join-Path $installDir 'host-manifest.json'
$configFile = Join-Path $installDir 'config.json'

try {
  Write-Host ''
  Write-Host '==========================================================' -ForegroundColor Cyan
  Write-Host '      ChatGuard Local 1.0.0 - installazione Windows'
  Write-Host '==========================================================' -ForegroundColor Cyan
  Write-Host 'Nessun servizio in background, nessuna API a pagamento.'
  Write-Host 'Non cambia i permessi dei download di Brave.'
  if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw 'File ChatGuardLocalHost.exe non trovato. Estrai tutto lo ZIP prima di eseguire INSTALLA.cmd.'
  }
  Write-Host ''
  Write-Host '1) Apri brave://extensions e attiva Modalita sviluppatore.'
  Write-Host '2) Installa l estensione dalla cartella extension in brave://extensions.'
  Write-Host '3) Copia l ID di 32 lettere mostrato sulla scheda ChatGuard Local.'
  $extensionID = (Read-Host 'Incolla l ID estensione (32 lettere)').Trim().ToLowerInvariant()
  if ($extensionID -cnotmatch '^[a-p]{32}$') {
    throw 'ID non valido: deve avere esattamente 32 lettere da a a p, senza spazi o prefissi.'
  }
  Write-Host ''
  Write-Host 'Seleziona la cartella principale dove saranno salvate le conversazioni.'
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Scegli la directory principale dei backup ChatGuard Local'
  $dialog.ShowNewFolderButton = $true
  $previousRoot = ''
  if (Test-Path -LiteralPath $configFile) {
    try {
      $previousConfig = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $previousRoot = [string]$previousConfig.backup_root
      if (Test-Path -LiteralPath $previousRoot -PathType Container) { $dialog.SelectedPath = $previousRoot }
    } catch { }
  }
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Installazione annullata: nessuna modifica effettuata.' -ForegroundColor Yellow
    exit 0
  }
  $backupRoot = [System.IO.Path]::GetFullPath($dialog.SelectedPath)
  if (-not [System.IO.Path]::IsPathRooted($backupRoot)) {throw 'Cartella di backup non valida.'}
  $probe = Join-Path $backupRoot ('.chatguard-test-' + [guid]::NewGuid().ToString('N') + '.tmp')
  [System.IO.File]::WriteAllText($probe, 'ok', [System.Text.Encoding]::UTF8)
  Remove-Item -LiteralPath $probe -Force
  Write-Host "Cartella: $backupRoot"
  Write-Host "ID autorizzato: $extensionID"
  Write-Host 'Procedo all installazione per questo utente Windows...' -ForegroundColor Cyan
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $cfg = @{ backup_root = $backupRoot; extension_id = $extensionID } | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($configFile, $cfg, $utf8NoBom)
  $hostManifest = @{name=$hostName;description='ChatGuard Local backup locale Windows';
    path=$targetExe;type='stdio';allowed_origins=@("chrome-extension://$extensionID/")} | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($manifestFile,$hostManifest,$utf8NoBom)
  # Registra l'host in HKCU con reg.exe (senza permessi amministrativi).
  # Controlla il valore prima di dichiarare l'installazione riuscita.
  $registryLocations = @(
    'Software\Google\Chrome\NativeMessagingHosts',
    'Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'
  )
  $regExe = Join-Path $env:SystemRoot 'System32\reg.exe'
  foreach ($parent in $registryLocations) {
    $relativeKey = "$parent\$hostName"
    $fullKey = "HKCU\$relativeKey"
    Write-Host "Registro l'host: $fullKey"
    $regResult = & $regExe add $fullKey /ve /t REG_SZ /d $manifestFile /f 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Registrazione fallita per $fullKey. $($regResult -join ' ')"
    }
    $checkKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relativeKey, $false)
    try {
      if ($null -eq $checkKey -or [string]$checkKey.GetValue('', '') -cne $manifestFile) {
        throw "Verifica Registro fallita per $fullKey. Il percorso del manifest non corrisponde."
      }
    } finally {
      if ($null -ne $checkKey) { $checkKey.Close() }
    }
  }
  & $targetExe --selftest
  if ($LASTEXITCODE -ne 0) { throw 'Il programma locale non riesce a scrivere nella cartella scelta.' }
  Write-Host ''
  Write-Host 'INSTALLAZIONE COMPLETATA.' -ForegroundColor Green
  Write-Host '1. Torna su brave://extensions e premi Ricarica su ChatGuard Local.'
  Write-Host '2. Vai su ChatGuard > Impostazioni > Verifica collegamento.'
  Write-Host '3. Apri una chat e premi Salva adesso per la prova.'
  Write-Host ''
  Write-Host 'NOTA: gli ZIP precedenti sono rimasti intatti. Le impostazioni dei download di Brave non sono state cambiate.'
} catch {
  Write-Host ''
  Write-Host ('ERRORE: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'I backup gia salvati non vengono eliminati. Riprova senza avviare INSTALLA.cmd come amministratore.'
  exit 1
}
