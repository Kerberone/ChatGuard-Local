/* ChatGuard Local - helpers shared by content script, service worker and tests.
 * Inspired by pinguarmy/ai-chat-exporter (MIT). Original implementation.
 */
(function (root, factory) {
  const api = factory()
  root.ChatGuardLocal = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function conversationIdFromUrl(url) {
    try {
      const p = new URL(url).pathname
      const m = p.match(/(?:^|\/)c\/([a-zA-Z0-9-]{16,})(?:\/|$)/)
      return m ? m[1] : null
    } catch (_) { return null }
  }

  function safeFilename(input, maxLength = 76) {
    const name = String(input || 'Senza_titolo')
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/\.+$/, '')
      .trim()
    return (name || 'Senza_titolo').slice(0, maxLength).replace(/[. ]+$/, '') || 'Senza_titolo'
  }

  function safeFolder(input) {
    const parts = String(input || 'ChatGPT_Backups')
      .split(/[\\/]+/)
      .filter(p => p !== '.' && p !== '..' && p.trim())
      .map(p => safeFilename(p, 55))
      .slice(0, 3)
    return parts.join('/') || 'ChatGPT_Backups'
  }

  function stringifyPart(part) {
    if (typeof part === 'string') return part
    if (part == null) return ''
    if (typeof part !== 'object') return String(part)
    if (typeof part.text === 'string') return part.text
    if (typeof part.content === 'string') return part.content
    if (typeof part.transcript === 'string') return part.transcript
    if (typeof part.asset_pointer === 'string') return `[Allegato: ${part.asset_pointer}]`
    if (typeof part.name === 'string') return `[${part.name}]`
    try { return JSON.stringify(part) } catch (_) { return '[Contenuto strutturato]' }
  }

  function toContentText(content) {
    if (!content) return ''
    if (Array.isArray(content.parts)) return content.parts.map(stringifyPart).filter(Boolean).join('\n\n')
    if (typeof content.text === 'string') return content.text
    if (typeof content.content === 'string') return content.content
    return stringifyPart(content)
  }

  function parseApiConversation(data, id) {
    if (!data || typeof data !== 'object' || !data.mapping || typeof data.mapping !== 'object') {
      throw new Error('Formato della conversazione API non riconosciuto')
    }
    const mapping = data.mapping
    let order = []
    let current = data.current_node || null
    const seen = new Set()
    while (current && mapping[current] && !seen.has(current)) {
      seen.add(current)
      order.push(current)
      current = mapping[current].parent || null
    }
    order.reverse()
    if (!order.length) {
      order = Object.keys(mapping).sort((a, b) =>
        (mapping[a]?.message?.create_time || 0) - (mapping[b]?.message?.create_time || 0))
    }
    const messages = order.map(nodeId => {
      const node = mapping[nodeId]
      const msg = node && node.message
      if (!msg || !msg.author) return null
      return {
        id: String(msg.id || nodeId),
        role: String(msg.author.role || 'unknown'),
        name: msg.author.name || '',
        timestamp: typeof msg.create_time === 'number'
          ? new Date(msg.create_time * 1000).toISOString() : '',
        model: msg.metadata?.model_slug || msg.metadata?.default_model_slug || '',
        text: toContentText(msg.content),
        contentType: msg.content?.content_type || '',
      }
    }).filter(Boolean)
    if (!messages.length) throw new Error('API: nessun messaggio riconosciuto')
    return {
      id: String(data.conversation_id || id || ''),
      title: String(data.title || 'Conversazione ChatGPT'),
      messages,
      raw: data,
      source: 'api',
      warning: null,
    }
  }

  function toCSV(snapshot) {
    const quoted = val => {
      let value = String(val == null ? '' : val)
      // Prevent cell-formula execution when opening untrusted conversation text in Excel.
      if (/^[=+\-@\t\r]/.test(value)) value = "'" + value
      return `"${value.replace(/"/g, '""')}"`
    }
    const rows = [['Timestamp', 'Role', 'Model', 'Message ID', 'Message', 'Source']]
    for (const m of snapshot.messages || []) {
      rows.push([m.timestamp || '', m.role || '', m.model || '', m.id || '', m.text || '', snapshot.source || ''])
    }
    return '\uFEFF' + rows.map(r => r.map(quoted).join(',')).join('\r\n') + '\r\n'
  }

  function fingerprintPayload(snapshot) {
    // Includes the entire mapping so alternate branches are protected as well as the visible chain.
    // Ignores volatile fields outside the conversation tree.
    if (snapshot.source === 'api' && snapshot.raw?.mapping) {
      const records = Object.entries(snapshot.raw.mapping).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, node]) => [key, node?.parent || null, node?.message || null])
      return JSON.stringify([snapshot.title, snapshot.raw.current_node || '', records])
    }
    return JSON.stringify([snapshot.title, (snapshot.messages || []).map(m => [m.id, m.role, m.text])])
  }

  function makeTimestamp(date = new Date()) {
    const p = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  }

  function toBackupBase(snapshot, folder, date = new Date()) {
    const id = safeFilename(snapshot.id || 'sconosciuta', 44)
    const title = safeFilename(snapshot.title || 'Senza titolo', 54)
    const prefix = safeFolder(folder)
    const flag = snapshot.source === 'dom' ? '_DOM-PARZIALE' : ''
    return `${prefix}/${title}_${id}/${makeTimestamp(date)}_${(snapshot.messages || []).length}msg${flag}`
  }

  function countConversationalMessages(messages) {
    return (messages || []).filter(m => m.role === 'user' || m.role === 'assistant').length
  }


  function attachmentId(raw) {
    const s = String(raw || '')
    const match = s.match(/file_[a-zA-Z0-9-]{8,}/)
    return match ? match[0] : ''
  }
  function collectAssets(raw) {
    if (!raw?.mapping || typeof raw.mapping !== 'object') return {assets:[], unknownLinks:[]}
    const assets = new Map()
    const unknownLinks = []
    for (const [nodeId,node] of Object.entries(raw.mapping)) {
      const msg = node?.message
      if (!msg) continue
      const messageId = String(msg.id || nodeId)
      const timestamp = typeof msg.create_time === 'number' ? new Date(msg.create_time*1000).toISOString() : ''
      const add = (idInput,name,mime,kind) => {
        const id=attachmentId(idInput)
        if (!id) return
        if (!assets.has(id)) assets.set(id,{id,name:'',mime:'',kind:'',references:[],messageIds:[]})
        const item=assets.get(id)
        if (name && !item.name) item.name = String(name)
        if (mime && !item.mime) item.mime = String(mime)
        if (kind && !item.kind) item.kind = kind
        if (!item.messageIds.includes(messageId)) item.messageIds.push(messageId)
        item.references.push({nodeId,messageId,timestamp,role:msg.author?.role||'',kind})
      }
      for(const att of msg.metadata?.attachments || []) {
        add(att.id||att.file_id||att.fileId||att.asset_pointer,
          att.name||att.filename||att.file_name||'',att.mime_type||att.mime||'','allegato')
      }
      const walk=(obj,depth=0)=>{
        if (!obj || depth>10 || typeof obj!=='object') return
        if (Array.isArray(obj)) { for(const x of obj) walk(x,depth+1); return }
        for(const [k,v] of Object.entries(obj)) {
          if (['asset_pointer','image_asset_pointer','audio_asset_pointer','video_asset_pointer','file_id','fileId'].includes(k) && typeof v==='string') {
            add(v,obj.name||obj.filename||obj.file_name||'',obj.mime_type||obj.mime||'',obj.content_type||'media')
          }
          if (v && typeof v==='object') walk(v,depth+1)
        }
      }
      walk(msg.content)
      // sandbox links are references to runtime files, not downloadable backend file IDs.
      // Record them explicitly instead of claiming they have been backed up.
      const text=toContentText(msg.content)
      for(const match of text.matchAll(/sandbox:\/mnt\/data\/[^\s)\]"'>]+/g)) {
        unknownLinks.push({messageId,timestamp,link:match[0],reason:'File temporaneo senza ID scaricabile dalla cronologia'})
      }
    }
    return {assets:Array.from(assets.values()),unknownLinks}
  }
  function snapshotTimeline(snapshot,assetFiles=[]) {
    const mapping=snapshot.raw?.mapping
    if (!mapping || snapshot.source!=='api') return (snapshot.messages||[]).map((m,index)=>({...m,index,active:true,assets:[]}))
    const active=new Set((snapshot.messages||[]).map(m=>m.id))
    const byId=new Map()
    for(const a of assetFiles) for(const id of a.messageIds||[]) {
      if(!byId.has(id)) byId.set(id,[])
      byId.get(id).push(a)
    }
    const timeline=[]
    for(const [nodeId,node] of Object.entries(mapping)) {
      const m=node?.message
      if (!m || !m.author) continue
      const id=String(m.id||nodeId)
      timeline.push({nodeId,id,role:m.author.role||'',timestamp: typeof m.create_time === 'number' ? new Date(m.create_time*1000).toISOString():'',
        text:toContentText(m.content), model:m.metadata?.model_slug||'', active:active.has(id),
        parentNodeId:node.parent||null, assets:byId.get(id)||[]})
    }
    return timeline.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.nodeId.localeCompare(b.nodeId))
  }
  function toMarkdown(snapshot, timeline) {
    const q=t=>String(t||'').replace(/\r\n?/g,'\n')
    let result=`# ${q(snapshot.title)}\n\n- Conversazione: ${snapshot.url||''}\n- Backup: ${snapshot.captureTime}\n- Fonte: ${snapshot.source==='api'?'API della conversazione':'pagina visualizzata (PARZIALE)'}\n\n`
    const render=(m)=>{
      const who={user:'Utente',assistant:'Assistente',tool:'Strumento',system:'Sistema',developer:'Sviluppatore'}[m.role]||m.role
      let section=`### ${m.timestamp || 'Data sconosciuta'} — ${who}${m.active===false?' (altro ramo)':''}\n\n${q(m.text)||'_[Messaggio senza testo semplice]_'}\n\n`
      for(const att of m.assets||[]) section+=`- Allegato: [${q(att.name||att.id)}](../../allegati/${att.filename})${att.status&&att.status!=='da_verificare'?` (${att.status})`:''}\n`
      return section+'\n'
    }
    for(const m of timeline.filter(m=>m.active!==false)) result+=render(m)
    const others=timeline.filter(m=>m.active===false)
    if(others.length) { result+='\n---\n\n## Altri rami della conversazione\n\n'; for(const m of others) result+=render(m) }
    return result
  }
  function safeAssetName(asset) {
    const extByMime={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif',
      'application/pdf':'.pdf','application/zip':'.zip','text/markdown':'.md','text/plain':'.txt',
      'text/csv':'.csv','application/json':'.json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx'}
    const raw=safeFilename(asset.name||'allegato',80)
    const extension=/\.[a-zA-Z0-9]{1,8}$/.test(raw)?'':(extByMime[asset.mime]||'')
    return `${safeFilename(asset.id,52)}__${raw}${extension}`
  }
  return {
    conversationIdFromUrl, safeFilename, safeFolder, stringifyPart,
    toContentText, parseApiConversation, toCSV, fingerprintPayload,
    makeTimestamp, toBackupBase, countConversationalMessages,
    collectAssets, snapshotTimeline, toMarkdown, safeAssetName,
  }
})
