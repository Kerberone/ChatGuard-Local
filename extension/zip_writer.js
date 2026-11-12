/* ZIP builder for Native Messaging: no browser download API. */
(() => {
  'use strict';
  const pending=new Map();let ticket=0;
  const MAX_ASSET=128*1024*1024,MAX_TOTAL=400*1024*1024;
  function allowed(url){
    try {const u=new URL(url);return u.protocol==='https:' &&
      (u.hostname==='chatgpt.com'||u.hostname==='chat.openai.com'||u.hostname.endsWith('.oaiusercontent.com'));}
    catch(_){return false}
  }
  async function createBundle(payload){
    const files=[],entries=[];let total=0;
    const add=(name,blob)=>{entries.push({name,blob});total+=blob.size};
    for(const asset of payload.assets||[]){
      const f={id:asset.id,filename:asset.filename,path:`allegati/${asset.filename}`,
        messageIds:asset.messageIds||[],status:'non_recuperato',reason:''};
      try {
        if(!asset.url||!allowed(asset.url))throw new Error(asset.error||'Nessun link scaricabile valido');
        const response=await fetch(asset.url,{credentials:'include',redirect:'follow',cache:'no-store'});
        if(!response.ok)throw new Error(`Il server non ha restituito l'allegato (HTTP ${response.status})`);
        const length=Number(response.headers.get('content-length')||0);
        if(length>MAX_ASSET)throw new Error('Allegato oltre 128 MB: non inserito nel backup ZIP');
        const mime=response.headers.get('content-type')||'';
        if(/text\/html|application\/json/i.test(mime))throw new Error('Ricevuta una pagina o un errore invece del file originale');
        const blob=await response.blob();
        if(!blob.size)throw new Error('Allegato vuoto');
        if(blob.size>MAX_ASSET||total+blob.size>MAX_TOTAL)throw new Error('Limite massimo degli allegati in uno ZIP raggiunto');
        add(f.path,blob);f.size=blob.size;f.status='salvato';
      } catch(err){f.reason=String(err?.message||err)}
      files.push(f);
    }
    for(const f of payload.textFiles) {
      // Keep Markdown links to ../allegati/ correct.
      const blob=new Blob([f.text],{type:'text/plain;charset=utf-8'});
      add(`snapshot/${payload.snapshotFolder}/${f.name}`,blob);
    }
    const missing=files.filter(f=>f.status!=='salvato').length;
    const complete=payload.source==='api'&&!missing&&files.length===payload.manifest.expectedAssets&&
      (payload.manifest.attachmentsRequested||!payload.manifest.expectedAssets)&&
      !payload.manifest.historyTruncated&&!payload.manifest.destinationFallback&&
      !(payload.unknownLinks||[]).length;
    const manifest={...payload.manifest,complete,result:complete?'COMPLETO':'PARZIALE',
      assets:files,unresolvedLinks:payload.unknownLinks||[],savedAt:new Date().toISOString(),
      archiveMode:'zip-native-local',notice:'Il backup è valido solo quando il programma Windows ne ha confermato la scrittura e verifica ZIP.'};
    add(`snapshot/${payload.snapshotFolder}/stato_backup.json`,
      new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));
    if(total>MAX_TOTAL)throw new Error('Cronologia e allegati oltre il limite massimo ZIP di 400 MB');
    const blob=await globalThis.ChatGuardZip.create(entries);
    const token=String(++ticket);
    const url=URL.createObjectURL(blob);
    pending.set(token,{url,blob});
    return {ok:true,token,url,files,complete,size:blob.size,
      savedFiles:payload.textFiles.length+files.filter(f=>f.status==='salvato').length+1};
  }
  function release(token){const entry=pending.get(token);if(entry){URL.revokeObjectURL(entry.url);pending.delete(token)}return {ok:true}}
  async function readChunk(payload){
    const entry=pending.get(payload.token)
    if(!entry)throw new Error('Archivio ZIP non più disponibile')
    const offset=Number(payload.offset),length=Number(payload.length)
    if(!Number.isSafeInteger(offset)||offset<0||offset>=entry.blob.size||!Number.isSafeInteger(length)||length<1||length>192*1024)
      throw new Error('Intervallo di lettura ZIP non valido')
    const bytes=new Uint8Array(await entry.blob.slice(offset,offset+length).arrayBuffer())
    let binary=''
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
    return {ok:true,data:btoa(binary),bytes:bytes.length,total:entry.blob.size}
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.to!=='CHATGUARD_ZIP')return false;
    const work=message.op==='CREATE'?createBundle(message.payload)
      :message.op==='READ'?readChunk(message.payload)
      :message.op==='RELEASE'?Promise.resolve(release(message.payload.token))
      :Promise.resolve({ok:false,error:'Operazione ZIP sconosciuta'});
    work.then(respond).catch(e=>respond({ok:false,error:String(e?.message||e)}));
    return true;
  });
})();
