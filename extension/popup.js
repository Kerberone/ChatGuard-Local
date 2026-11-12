const $=id=>document.getElementById(id)
function brief(iso){if(!iso)return 'Mai';try{return new Date(iso).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(_){return '—'}}
async function load(){
  try {
    const r=await chrome.runtime.sendMessage({type:'GET_STATUS'})
    if(!r.ok)throw new Error(r.error||'Impossibile leggere lo stato del backup')
    $('dot').classList.toggle('on',r.settings.enabled&&!r.automaticPaused&&r.native?.ok)
    $('stateLabel').textContent=r.automaticPaused?'IN PAUSA • verifica programma locale e premi Salva adesso':!r.native?.ok?'NON COLLEGATO • installa programma Windows':r.settings.enabled?`Attivo • ogni ${r.settings.interval} min`:'Backup automatico spento'
    $('openChats').textContent=`${r.openChats} chat aperte`
    $('destination').textContent=r.native?.ok?`Cartella: ${r.native.root}`:'Programma locale non collegato'
    $('total').textContent=String(r.stats.snapshots||0)
    const items=Object.values(r.stats.byConversation||{}).sort((a,b)=>String(b.lastSavedAt||'').localeCompare(String(a.lastSavedAt||'')))
    $('latest').textContent=brief(items[0]?.lastSavedAt)
    const recent=$('recent'); recent.replaceChildren()
    if(!items.length){const p=document.createElement('p');p.textContent='Ancora nessun backup: premi «Salva adesso». ';recent.append(p)}
    for(const item of items.slice(0,8)){
      const entry=document.createElement('div');entry.className='item'
      const title=document.createElement('span');title.className='name';title.textContent=item.title||'Conversazione'
      const sub=document.createElement('small')
      sub.textContent=`${brief(item.lastSavedAt)} • ${item.lastCount||0} messaggi • ${item.savedAssets||0}/${item.expectedAssets||0} allegati • ${item.complete?'Completo':'PARZIALE'}`
      entry.append(title,sub);recent.append(entry)
    }
    const warnings=[]
    if(!r.native?.ok)warnings.push(r.native?.error||'Il programma Windows non risponde')
    if(r.automaticPaused)warnings.push(r.automaticPaused.reason)
    else if(r.lastError)warnings.push(r.lastError)
    $('warning').hidden=!warnings.length
    $('warning').textContent=warnings.join('\n')
  } catch(err){$('stateLabel').textContent='Errore di comunicazione';$('warning').hidden=false;$('warning').textContent=String(err.message||err)}
}
$('now').addEventListener('click',async()=>{
  $('now').disabled=true;$('now').textContent='Salvataggio...'
  try {
    const result=await chrome.runtime.sendMessage({type:'BACKUP_NOW'})
    await load()
    if(!result.ok)throw new Error(result.error||'Nessuna copia salvata')
    const issues=(result.results||[]).filter(x=>!x.ok||!x.complete)
    if(issues.length){$('warning').hidden=false;$('warning').textContent=issues.map(x=>x.warning||x.error||'Backup parziale').join('\n')}
  }catch(err){$('warning').hidden=false;$('warning').textContent=String(err.message||err)}
  finally{$('now').disabled=false;$('now').textContent='Salva adesso'}
})
$('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage())
load()
