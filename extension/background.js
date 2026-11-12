/* ChatGuard Local 1.0.0 — Native Messaging only; no browser downloads. */
importScripts('lib.js')
const lib=globalThis.ChatGuardLocal
const HOST='com.chatguard.local'
const ALARM='chatguard-local-periodic'
const PAUSE_KEY='automaticPaused'
const DEFAULTS={enabled:true,interval:5,folder:'ChatGPT_Backups',destination:'native',
 destinationRevision:0,saveJSON:true,saveCSV:true,saveMD:true,saveAssets:true,liveCapture:true}
const pending=new Map()
let creatingOffscreen=null

function friendly(error) {
  const msg=String(error?.message||error||'Errore sconosciuto')
  if(/Could not establish connection|Receiving end does not exist|message port closed/i.test(msg))
    return 'La scheda ChatGPT non risponde. Ricarica la pagina ChatGPT con Ctrl+R e riprova.'
  if(/Specified native messaging host not found|Native host has exited|native messaging host not found|host not found/i.test(msg))
    return 'Programma locale non collegato. Esegui INSTALLA.cmd e verifica che l’ID dell’estensione sia quello mostrato in brave://extensions.'
  if(/Access to the specified native messaging host is forbidden|forbidden/i.test(msg))
    return 'Brave ha negato il collegamento: l’ID dell’estensione non corrisponde a quello autorizzato. Esegui nuovamente INSTALLA.cmd.'
  if(/not supported|connectNative/i.test(msg))
    return 'Brave non consente la comunicazione con il programma locale in questo contesto.'
  return msg
}
function normalize(input) {
  const s={...DEFAULTS,...(input||{})}
  s.enabled=!!s.enabled
  s.liveCapture=!!s.liveCapture
  s.saveJSON=true
  s.saveCSV=!!s.saveCSV
  s.saveMD=!!s.saveMD
  s.saveAssets=!!s.saveAssets
  s.interval=[3,5,10,15,30,60].includes(Number(s.interval))?Number(s.interval):5
  s.folder=lib.safeFolder(s.folder).replaceAll('/','_')
  s.destination='native' // Safety rule: NEVER perform browser downloads.
  s.destinationRevision=Number(s.destinationRevision)||0
  return s
}
async function settings(){return normalize((await chrome.storage.local.get('settings')).settings)}
async function pauseAutomatic(reason){await chrome.storage.local.set({[PAUSE_KEY]:{at:new Date().toISOString(),reason},lastError:reason})}
async function pausedAutomatic(){return (await chrome.storage.local.get(PAUSE_KEY))[PAUSE_KEY]||null}
async function armAlarm(){
  await chrome.alarms.clear(ALARM)
  const s=await settings()
  if(s.enabled)await chrome.alarms.create(ALARM,{delayInMinutes:s.interval,periodInMinutes:s.interval})
}
chrome.runtime.onInstalled.addListener(()=>{
  // Previous version pause flag referred to Brave downloads, which the v3 no longer uses.
  chrome.storage.local.set({[PAUSE_KEY]:null,lastError:null}).then(armAlarm).catch(console.error)
})
chrome.runtime.onStartup.addListener(()=>armAlarm().catch(console.error))
chrome.alarms.onAlarm.addListener(a=>{
  if(a.name===ALARM)backupAll('programmato').catch(e=>chrome.storage.local.set({lastError:friendly(e)}))
})
async function backupTabs(){
  const tabs=await chrome.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*']})
  return tabs.filter(t=>Number.isInteger(t.id)&&lib.conversationIdFromUrl(t.url||''))
}
async function captureTab(tab,reason){
  try {
    let result
    try {result=await chrome.tabs.sendMessage(tab.id,{type:'CAPTURE_CHAT',reason})}
    catch(e){
      if(!/Receiving end does not exist|Could not establish connection|message port closed/i.test(String(e?.message||e)))throw e
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['lib.js','content.js']})
      result=await chrome.tabs.sendMessage(tab.id,{type:'CAPTURE_CHAT',reason})
    }
    return {title:tab.title||'',...(result||{ok:false,error:'La scheda non ha restituito dati'})}
  }catch(e){return {ok:false,title:tab.title||'',error:`Scheda ${tab.id}: ${friendly(e)}`}}
}
async function backupAll(reason='manuale'){
  const s=await settings()
  if(!s.enabled&&reason!=='manuale')return {ok:false,error:'Backup automatico disattivato.'}
  const paused=await pausedAutomatic()
  if(reason!=='manuale'&&paused)return {ok:false,paused:true,error:paused.reason}
  const tabs=await backupTabs()
  if(!tabs.length)return {ok:false,error:'Nessuna conversazione ChatGPT aperta in Brave.'}
  const results=[]
  for(const tab of tabs)results.push(await captureTab(tab,reason))
  const errors=results.filter(r=>!r.ok||r.complete===false).map(r=>r.error||r.warning||'Backup parziale')
  if(reason==='manuale'&&results.some(r=>r.ok))await chrome.storage.local.set({[PAUSE_KEY]:null})
  await chrome.storage.local.set({lastError:errors.join(' | ')||null})
  return {ok:results.some(r=>r.ok),results}
}
async function digest(value){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')
}
async function offscreen(){
  const list=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('writer.html')]})
  if(list.length)return
  if(!creatingOffscreen)creatingOffscreen=chrome.offscreen.createDocument({url:'writer.html',
    reasons:['BLOBS'],justification:'Costruisce ZIP locali con file e cronologia senza effettuare download'}).finally(()=>creatingOffscreen=null)
  await creatingOffscreen
}
async function zipMessage(op,payload={}){
  await offscreen()
  return await chrome.runtime.sendMessage({to:'CHATGUARD_ZIP',op,payload})||{ok:false,error:'Modulo ZIP non raggiungibile'}
}
function connectHost(){
  let port
  try {port=chrome.runtime.connectNative(HOST)}catch(e){throw new Error(friendly(e))}
  const queue=[]
  let disconnected=false
  let closeReason='Il programma locale si è scollegato.'
  port.onMessage.addListener(msg=>{
    const item=queue.shift()
    if(!item)return
    clearTimeout(item.timer)
    if(msg?.ok)item.resolve(msg)
    else item.reject(new Error(msg?.error||'Il programma locale ha rifiutato la richiesta'))
  })
  port.onDisconnect.addListener(()=>{
    disconnected=true
    closeReason=friendly(chrome.runtime.lastError||closeReason)
    while(queue.length){const item=queue.shift();clearTimeout(item.timer);item.reject(new Error(closeReason))}
  })
  return {
    async send(message,timeoutMs=60000){
      if(disconnected)throw new Error(closeReason)
      return new Promise((resolve,reject)=>{
        const item={resolve,reject,timer:setTimeout(()=>{
          const index=queue.indexOf(item);if(index>=0)queue.splice(index,1)
          try{port.disconnect()}catch(_){}
          reject(new Error('Il programma locale non ha risposto in tempo. Backup NON confermato.'))
        },timeoutMs)}
        queue.push(item)
        try{port.postMessage(message)}catch(e){
          clearTimeout(item.timer);queue.splice(queue.indexOf(item),1);reject(e)
        }
      })
    },
    close(){try{port.disconnect()}catch(_){}}
  }
}
async function nativeStatus(){
  const connection=connectHost()
  try{return await connection.send({op:'ping'})}
  finally{connection.close()}
}
async function chooseRoot(){
  const connection=connectHost()
  try{return await connection.send({op:'choose_root'},300000)}
  finally{connection.close()}
}
async function saveToNative(payload){
  // Browser ZIP creation remains local to the extension; no downloads ever invoked.
  const bundle=await zipMessage('CREATE',payload)
  if(!bundle.ok)throw new Error(bundle.error||'Impossibile costruire lo ZIP')
  const filename=`snapshot_${payload.snapshotFolder}.zip`
  let connection
  try{
    connection=connectHost()
    const id=crypto.randomUUID().replaceAll('-','')
    await connection.send({op:'begin',id,folder:payload.subfolders.join('_'),conversation:payload.conversationFolder,
      fileName:filename,total:bundle.size})
    let offset=0,seq=0
    const CHUNK=128*1024
    while(offset<bundle.size){
      const part=await zipMessage('READ',{token:bundle.token,offset,length:CHUNK})
      if(!part?.ok||!part.data||!part.bytes)throw new Error(part?.error||'Dati ZIP non disponibili')
      await connection.send({op:'chunk',id,seq,data:part.data})
      offset+=part.bytes;seq++
    }
    const confirmation=await connection.send({op:'finish',id})
    if(!confirmation.ok||confirmation.bytes!==bundle.size||!confirmation.path)throw new Error('Il programma locale non ha confermato il file completo')
    return {ok:true,complete:bundle.complete,files:bundle.files,snapshot:confirmation.path,
      savedFiles:bundle.savedFiles,archiveBytes:confirmation.bytes,sha256:confirmation.sha256}
  }finally{
    if(connection)connection.close()
    await zipMessage('RELEASE',{token:bundle.token}).catch(()=>{})
  }
}
async function resolveAssets(tabId,convId,assets){
  if(!assets.length)return []
  try{
    const result=await chrome.tabs.sendMessage(tabId,{type:'RESOLVE_ASSETS',conversationId:convId,ids:assets.map(a=>a.id)})
    if(!result?.ok)throw new Error(result?.error||'Impossibile ottenere gli allegati')
    const map=new Map((result.assets||[]).map(a=>[a.id,a]))
    return assets.map(a=>({...a,...(map.get(a.id)||{error:'Nessuna risposta per questo file'})}))
  }catch(e){return assets.map(a=>({...a,error:friendly(e)}))}
}
async function saveSnapshot(snapshot,tabId){
  if(!snapshot?.id||!Array.isArray(snapshot.messages)||!snapshot.messages.length)
    return {ok:false,error:'La conversazione non contiene messaggi da salvare.'}
  const key=String(snapshot.id)
  if(pending.has(key))return pending.get(key)
  const work=(async()=>{
    const s=await settings()
    if(await pausedAutomatic() && snapshot.reason!=='manuale')
      return {ok:false,error:'Backup in pausa: controlla il collegamento del programma locale e premi Salva adesso.'}
    const stateKey=`conversation:${key}`
    const store=await chrome.storage.local.get([stateKey,'stats'])
    const previous=store[stateKey]||{}
    const destKey=['native',s.folder,s.destinationRevision].join(':')
    const hash=await digest(lib.fingerprintPayload(snapshot))
    if(previous.destKey===destKey && previous.hash===hash && previous.source===snapshot.source && previous.lastSavedAt &&
       (previous.complete||snapshot.reason!=='manuale'))
      return {ok:true,unchanged:true,complete:!!previous.complete,warning:previous.warning||null,
        title:snapshot.title,count:snapshot.messages.length}
    const count=lib.countConversationalMessages(snapshot.messages)
    const decreased=snapshot.source==='api'&&Number.isFinite(previous.apiCount)&&count<previous.apiCount
    const {assets:found,unknownLinks}=lib.collectAssets(snapshot.raw)
    const wanted=s.saveAssets?found:[]
    const assets=(await resolveAssets(tabId,key,wanted)).map(a=>({...a,filename:lib.safeAssetName(a)}))
    const timeline=lib.snapshotTimeline(snapshot,assets.map(a=>({...a,status:'da_verificare'})))
    const stamp=lib.makeTimestamp(new Date())
    const folderName=`${lib.safeFilename(snapshot.title,54)}_${lib.safeFilename(snapshot.id,44)}`
    const snapshotFolder=`${stamp}_${Math.random().toString(36).slice(2,10)}`
    const record={formatVersion:3,conversationId:key,title:snapshot.title,url:snapshot.url,source:snapshot.source,
      capturedAt:snapshot.captureTime,reason:snapshot.reason,activeMessageCount:count,
      allBranchMessageCount:timeline.length,timeline,attachments:found,unknownLinks,raw:snapshot.raw,
      warning:snapshot.warning||null,messages:snapshot.messages}
    const textFiles=[{name:'conversazione.json',text:JSON.stringify(record,null,2)}]
    if(s.saveCSV){
      const csvSnapshot={...snapshot,messages:timeline.map(m=>({id:m.id,role:m.role,model:m.model,
        timestamp:m.timestamp,text:`${m.active?'[RAMO ATTIVO]':'[ALTRO RAMO]'} ${m.text}`}))}
      textFiles.push({name:'conversazione.csv',text:lib.toCSV(csvSnapshot)})
    }
    if(s.saveMD)textFiles.push({name:'conversazione.md',text:lib.toMarkdown(snapshot,timeline)})
    let warning=snapshot.warning||null
    if(decreased)warning=`ATTENZIONE: cronologia API accorciata da ${previous.apiCount} a ${count} messaggi. Conservate le versioni precedenti. ${warning||''}`
    if(!s.saveAssets&&found.length)warning=`Allegati disattivati: ${found.length} file non salvati. ${warning||''}`
    const payload={subfolders:[s.folder],conversationFolder:folderName,snapshotFolder,source:snapshot.source,
      assets,textFiles,unknownLinks,manifest:{version:3,conversationId:key,title:snapshot.title,
        source:snapshot.source,capturedAt:snapshot.captureTime,url:snapshot.url,activeMessageCount:count,
        allBranchMessageCount:timeline.length,expectedAssets:found.length,note:warning,
        historyTruncated:decreased,attachmentsRequested:s.saveAssets}}
    let result
    try{result=await saveToNative(payload)}
    catch(e){
      const error=`Backup NON salvato: ${friendly(e)}`
      await pauseAutomatic(`${error} Apri Impostazioni per verificare il collegamento, poi premi «Salva adesso».`)
      return {ok:false,error}
    }
    const savedIds=result.files.filter(f=>['salvato','gia_salvato'].includes(f.status)).map(f=>f.id)
    const missing=result.files.filter(f=>!['salvato','gia_salvato'].includes(f.status))
    const warnings=[warning]
    if(missing.length)warnings.push(`${missing.length} allegati mancanti (vedi stato_backup.json)`)
    if(unknownLinks.length)warnings.push(`${unknownLinks.length} link a file temporanei non recuperati`)
    if(snapshot.source!=='api')warnings.push('Backup solo DOM: cronologia non completa')
    const complete=!!result.complete&&!decreased
    const warningText=warnings.filter(Boolean).join(' | ')||null
    const newState={hash,source:snapshot.source,complete,destKey,lastSavedAt:new Date().toISOString(),
      lastCount:count,apiCount:snapshot.source==='api'?Math.max(Number(previous.apiCount)||0,count):previous.apiCount,
      lastFile:result.snapshot,assetSavedIds:savedIds,expectedAssets:found.length,
      savedAssets:savedIds.length,missingAssets:missing.length,warning:warningText,title:snapshot.title,
      sha256:result.sha256,archiveBytes:result.archiveBytes}
    const stats=store.stats||{snapshots:0,byConversation:{}}
    stats.snapshots=(stats.snapshots||0)+1
    stats.byConversation=stats.byConversation||{}
    stats.byConversation[key]={title:snapshot.title,...newState}
    await chrome.storage.local.set({[stateKey]:newState,stats,lastError:warningText,[PAUSE_KEY]:null})
    return {ok:true,saved:true,complete,title:snapshot.title,count,attachmentCount:found.length,
      attachmentsSaved:savedIds.length,missingAssets:missing.length,warning:warningText,folder:result.snapshot}
  })()
  pending.set(key,work)
  try{return await work}finally{pending.delete(key)}
}
async function getStatus(){
  const [data,tabs]=await Promise.all([
    chrome.storage.local.get(['stats','lastError',PAUSE_KEY]),backupTabs()])
  let native
  try{native=await nativeStatus()}
  catch(e){native={ok:false,error:friendly(e)}}
  return {ok:true,settings:await settings(),stats:data.stats||{snapshots:0,byConversation:{}},
    lastError:data.lastError||null,automaticPaused:data[PAUSE_KEY]||null,native,
    folderName:native.root||'',openChats:tabs.length}
}
async function onMessage(msg,sender){
  if(msg?.to==='CHATGUARD_ZIP')return
  switch(msg?.type){
    case 'SAVE_SNAPSHOT': {
      if(!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(sender.tab?.url||''))
        return {ok:false,error:'Origine della scheda non autorizzata'}
      if(lib.conversationIdFromUrl(sender.tab.url)!==msg.snapshot?.id)
        return {ok:false,error:'La scheda è passata a un’altra conversazione durante il salvataggio'}
      return saveSnapshot(msg.snapshot,sender.tab.id)
    }
    case 'GET_STATUS':return getStatus()
    case 'CHECK_NATIVE':{
      try{return await nativeStatus()}catch(e){return {ok:false,error:friendly(e)}}
    }
    case 'CHOOSE_NATIVE_ROOT':{
      if(pending.size)return {ok:false,error:'È in corso un backup: cambia cartella quando è terminato.'}
      const result=await chooseRoot()
      if(result.ok){
        const old=await settings()
        await chrome.storage.local.set({settings:{...old,destinationRevision:old.destinationRevision+1}})
      }
      return result
    }
    case 'BACKUP_NOW':return backupAll('manuale')
    case 'SAVE_SETTINGS':{
      const old=await settings()
      const s=normalize({...msg.settings,destinationRevision:old.destinationRevision})
      await chrome.storage.local.set({settings:s})
      await armAlarm()
      return getStatus()
    }
    case 'PAGE_READY':{
      if(!(await settings()).enabled||!sender.tab?.id)return {ok:false}
      return captureTab(sender.tab,'apertura-scheda')
    }
    case 'PAGE_CHANGED':{
      const s=await settings()
      if(!s.enabled||!s.liveCapture||!sender.tab?.id)return {ok:false}
      const id=lib.conversationIdFromUrl(sender.tab.url||'')
      if(!id)return {ok:false}
      const data=await chrome.storage.local.get(`conversation:${id}`)
      const latest=data[`conversation:${id}`]?.lastSavedAt
      if(latest&&Date.now()-new Date(latest).getTime()<45000)return {ok:true,unchanged:true}
      return captureTab(sender.tab,'modifica-pagina')
    }
    default:return {ok:false,error:'Richiesta non riconosciuta'}
  }
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(msg?.to==='CHATGUARD_ZIP')return false
  onMessage(msg,sender).then(respond).catch(e=>respond({ok:false,error:friendly(e)}))
  return true
})
