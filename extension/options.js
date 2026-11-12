const $=id=>document.getElementById(id)
const fields=['enabled','interval','folder','liveCapture','saveCSV','saveMD','saveAssets']
let currentSettings={}
function showMessage(message,error=false){
  $('message').textContent=message
  $('message').classList.toggle('error',error)
}
function showNative(result){
  $('nativeStatus').textContent=result?.ok
    ? `Collegato a ChatGuard Local Host ${result.version||''}. Cartella principale: ${result.root}`
    : `NON COLLEGATO: ${result?.error||'Avvia INSTALLA.cmd nel pacchetto.'}`
  $('chooseFolder').disabled=!result?.ok
}
async function load(){
  const r=await chrome.runtime.sendMessage({type:'GET_STATUS'})
  if(!r?.ok)throw new Error(r?.error||'Impossibile leggere le impostazioni')
  currentSettings=r.settings
  for(const id of fields){
    const el=$(id)
    if(el.type==='checkbox')el.checked=!!currentSettings[id]
    else el.value=String(currentSettings[id]??'')
  }
  showNative(r.native)
}
$('checkNative').addEventListener('click',async()=>{
  showMessage('Controllo collegamento...')
  try{
    const r=await chrome.runtime.sendMessage({type:'CHECK_NATIVE'})
    showNative(r)
    showMessage(r.ok?'Programma locale pronto per i backup.':r.error,!r.ok)
  }catch(e){showMessage(String(e.message||e),true)}
})
$('chooseFolder').addEventListener('click',async()=>{
  $('chooseFolder').disabled=true
  showMessage('Apertura della finestra Windows per scegliere la cartella...')
  try{
    const r=await chrome.runtime.sendMessage({type:'CHOOSE_NATIVE_ROOT'})
    if(!r?.ok)throw new Error(r?.error||'Cartella non modificata')
    showNative({...r,version:'1.0'})
    showMessage('Nuova directory principale salvata: '+r.root)
  }catch(e){showMessage(String(e.message||e),true)}
  finally{$('chooseFolder').disabled=false}
})
function payload(){
  const s={...currentSettings}
  for(const id of fields){
    const el=$(id);s[id]=el.type==='checkbox'?el.checked:el.value
  }
  s.interval=Number(s.interval)
  return s
}
$('save').addEventListener('click',async()=>{
  showMessage('Salvataggio impostazioni...')
  try{
    const r=await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings:payload()})
    if(!r.ok)throw new Error(r.error||'Errore durante il salvataggio')
    currentSettings=r.settings
    showMessage('Impostazioni salvate. Nessun download automatico del browser è stato autorizzato.')
  }catch(e){showMessage(String(e.message||e),true)}
})
$('backup').addEventListener('click',async()=>{
  $('backup').disabled=true
  showMessage('Salvataggio locale in corso...')
  try{
    const r=await chrome.runtime.sendMessage({type:'BACKUP_NOW'})
    if(!r.ok)throw new Error(r.error||(r.results||[]).map(x=>x.error).join(' | ')||'Nessun backup salvato')
    const issues=(r.results||[]).filter(x=>!x.ok||!x.complete)
    showMessage(issues.length?`Salvataggio con avvisi: ${issues.map(x=>x.warning||x.error||'Backup parziale').join(' | ')}`
      :'Backup concluso e verificato sul disco.',!!issues.length)
  }catch(e){showMessage(String(e.message||e),true)}
  finally{$('backup').disabled=false}
})
load().catch(e=>showMessage(String(e.message||e),true))
