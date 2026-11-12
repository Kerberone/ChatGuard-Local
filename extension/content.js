/* ChatGPT-only capture. No paid API and no extension credential storage. */
(() => {
  'use strict'
  if (globalThis.__CHATGUARD_RUNNING) return
  globalThis.__CHATGUARD_RUNNING = true
  const lib=globalThis.ChatGuardLocal
  let capturing=false
  let lastHint=0
  let debounceTimer
  let lastChat=null
  let tokenPromise
  function chatId() {return lib.conversationIdFromUrl(location.href)}
  function friendlyError(error) {
    const msg=String(error?.message||error||'')
    if (/Could not establish connection|Receiving end does not exist/.test(msg)) return 'La scheda non risponde. Ricarica ChatGPT e riprova.'
    return msg
  }
  function parseDOM() {
    const raw=Array.from(document.querySelectorAll('[data-message-author-role]'))
    const nodes=raw.length ? raw : Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'))
    const messages=[]
    for (let i=0;i<nodes.length;i++) {
      const node=nodes[i]
      const role=node.getAttribute('data-message-author-role')||node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role')||'assistant'
      let text=Array.from(node.querySelectorAll('.markdown,[data-message-content]'))
        .filter(el=>!el.parentElement?.closest('.markdown,[data-message-content]'))
        .map(el=>el.innerText||el.textContent||'').join('\n\n').trim()
      if(!text) text=(node.innerText||node.textContent||'').trim()
      if(!text) continue
      const id=node.getAttribute('data-message-id')||node.getAttribute('data-testid')||`dom-${i}`
      messages.push({id,role,timestamp:'',model:'',text,contentType:'dom'})
    }
    if(!messages.length) throw new Error('Nessun messaggio leggibile nella scheda. Apri una chat e attendi che sia caricata.')
    return {id:chatId(), title:document.title.replace(/\s*[-–|]\s*ChatGPT\s*$/i,'').trim()||'Conversazione ChatGPT',
      source:'dom', messages, raw:null,
      warning:'Backup PARZIALE: la pagina potrebbe mostrare solo una parte dei messaggi e non consente di recuperare tutti gli allegati.'}
  }
  async function authHeaders() {
    if (!tokenPromise) tokenPromise=fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'})
      .then(async response=>response.ok ? (await response.json())?.accessToken : null).catch(()=>null)
    const token=await tokenPromise
    return token ? {'Accept':'application/json','Authorization':`Bearer ${token}`} : {'Accept':'application/json'}
  }
  async function readAPI(id) {
    const headers=await authHeaders()
    const response=await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`,{headers,credentials:'same-origin',cache:'no-store'})
    if (!response.ok) throw new Error(`ChatGPT non ha fornito la cronologia completa (HTTP ${response.status}).`)
    return lib.parseApiConversation(await response.json(),id)
  }
  async function capture(reason) {
    const id=chatId()
    if(!id) return {ok:false,error:'Apri una conversazione ChatGPT (indirizzo /c/...) prima di salvare.'}
    if(capturing) return {ok:false,error:'Il salvataggio è già in corso in questa scheda.'}
    capturing=true
    try {
      let snapshot, apiError=''
      try { snapshot=await readAPI(id) } catch(err) { apiError=friendlyError(err) }
      if (!snapshot) { snapshot=parseDOM(); snapshot.warning+=` Motivo: ${apiError}` }
      snapshot.url=location.href
      snapshot.captureTime=new Date().toISOString()
      snapshot.reason=reason
      return await chrome.runtime.sendMessage({type:'SAVE_SNAPSHOT',snapshot})
    } catch(err) {return {ok:false,error:friendlyError(err)}}
    finally { capturing=false }
  }
  function safeAssetUrl(url) {
    try {const u=new URL(url,location.origin);return u.protocol==='https:' &&
      (['chatgpt.com','chat.openai.com'].includes(u.hostname)||u.hostname.endsWith('.oaiusercontent.com')) ? u.href:null }
    catch(_){return null}
  }
  async function resolveOne(id,conv) {
    const routes=[
      `/backend-api/files/download/${encodeURIComponent(id)}?conversation_id=${encodeURIComponent(conv)}&inline=false`,
      `/backend-api/conversation/${encodeURIComponent(conv)}/attachment/${encodeURIComponent(id)}/download`,
      `/backend-api/files/${encodeURIComponent(id)}/download`,
    ]
    const errors=[]
    const headers=await authHeaders()
    for (const route of routes) {
      try {
        // Other endpoints may redirect directly to a signed file URL.
        const response=await fetch(route,{credentials:'same-origin',headers,cache:'no-store',redirect:'follow'})
        if (!response.ok) {errors.push(`HTTP ${response.status}`);continue}
        const type=response.headers.get('content-type')||''
        if (type.includes('json')) {
          const data=await response.json()
          const url=safeAssetUrl(data.download_url||data.url||data.file_url)
          if(url) return {id,url,name:data.file_name||data.filename||'',mime:data.mime_type||''}
          errors.push('Risposta senza indirizzo di download')
        } else {
          // Could be a binary response. Signed redirects become response.url.
          const redirected=safeAssetUrl(response.url)
          if(redirected && response.redirected) return {id,url:redirected}
          errors.push('Risposta non riutilizzabile per scaricare il file')
        }
      } catch(e) {errors.push(friendlyError(e))}
    }
    return {id,url:null,error:errors.join(', ')||'File non accessibile'}
  }
  async function resolveAssets(ids,conversationId) {
    const out=[]
    for (const id of ids) out.push(await resolveOne(id,conversationId))
    return out
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (message?.type==='CAPTURE_CHAT') {
      capture(message.reason||'scheduled').then(respond).catch(e=>respond({ok:false,error:friendlyError(e)}))
      return true
    }
    if (message?.type==='RESOLVE_ASSETS') {
      if (!chatId()||message.conversationId!==chatId()) {respond({ok:false,error:'Conversazione cambiata durante il backup'});return false}
      resolveAssets(message.ids||[],chatId()).then(assets=>respond({ok:true,assets}))
        .catch(e=>respond({ok:false,error:friendlyError(e)}))
      return true
    }
    return false
  })
  function notifyChange() {
    if(!chatId()||Date.now()-lastHint<30000)return
    lastHint=Date.now()
    chrome.runtime.sendMessage({type:'PAGE_CHANGED'}).catch(()=>{})
  }
  const observer=new MutationObserver(records=>{
    if(!chatId())return
    const relevant=records.some(r=>r.type==='characterData'
      ? !!r.target.parentElement?.closest('[data-message-author-role],[data-testid^="conversation-turn-"]')
      : Array.from(r.addedNodes).some(n=>n.nodeType===1 &&
        (n.matches?.('[data-message-author-role],[data-testid^="conversation-turn-"]')||
         n.querySelector?.('[data-message-author-role],[data-testid^="conversation-turn-"]'))))
    if(!relevant)return
    clearTimeout(debounceTimer)
    debounceTimer=setTimeout(notifyChange,12000)
  })
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true})
  setInterval(()=>{
    const id=chatId()
    if(id&&id!==lastChat) {lastChat=id;chrome.runtime.sendMessage({type:'PAGE_READY'}).catch(()=>{})}
    else if(!id) lastChat=null
  },2000)
})()
