# Removes only the local helper; NEVER deletes conversation backups.
$ErrorActionPreference = 'Stop'
$name='com.chatguard.local'
$dir=Join-Path $env:LOCALAPPDATA 'ChatGuardLocal'
$manifest=Join-Path $dir 'host-manifest.json'
Write-Host 'Disinstallazione del solo programma locale ChatGuard Local.'
Write-Host 'Gli archivi delle conversazioni NON saranno cancellati.'
$confirm = (Read-Host 'Digita DISINSTALLA per procedere').Trim()
if($confirm -cne 'DISINSTALLA'){Write-Host 'Operazione annullata.';exit 0}
foreach($key in @("HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$name",
                  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name")){
  if(Test-Path $key){
    $relative=$key.Substring(6)
    $h=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative,$false)
    try { if($null -ne $h -and [string]$h.GetValue('','') -ceq $manifest){$h.Close();Remove-Item -Path $key -Force} }
    finally { if($null -ne $h){$h.Close()} }
  }
}
# Remove ONLY helper files, never subfolders or ZIP archives chosen by the user.
foreach($file in @('ChatGuardLocalHost.exe','host-manifest.json','config.json')){
  $full=Join-Path $dir $file
  if(Test-Path -LiteralPath $full -PathType Leaf){Remove-Item -LiteralPath $full -Force}
}
if(Test-Path -LiteralPath $dir){
  if(-not @(Get-ChildItem -LiteralPath $dir -Force).Count){Remove-Item -LiteralPath $dir -Force}
}
Write-Host 'Programma locale disinstallato. I tuoi backup sono ancora nella cartella scelta.'
