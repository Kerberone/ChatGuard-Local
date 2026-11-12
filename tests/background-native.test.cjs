const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const folder=path.join(root,'extension');
const lib=require(path.join(folder,'lib.js'));
const zip=require(path.join(folder,'zip_lib.js'));
const extid='abcdefghijklmnopabcdefghijklmnop';
const conv='12345678-aaaa-bbbb-cccc-123456789abc';
const integration=!!process.env.CHATGUARD_HOST_TEST_BIN;

function fakeWorker(opts={}) {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chatguard-native-test-'));
 const host=path.join(temp,'host-linux');
 fs.copyFileSync(process.env.CHATGUARD_HOST_TEST_BIN || path.join(root,'host-linux'),host);
 const savePath=path.join(temp,'backup principale');fs.mkdirSync(savePath);
 fs.writeFileSync(path.join(temp,'config.json'),JSON.stringify({backup_root:savePath,extension_id:opts.badID?'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa':extid}));
 const store={}, saved=[];const listeners=[];let started=0;
 const ev=()=>({items:[],addListener(fn){this.items.push(fn)},removeListener(fn){this.items=this.items.filter(x=>x!==fn)},fire(...args){for(const l of [...this.items])l(...args)}});
 const msgEvent=ev(),installEvent=ev(),startupEvent=ev(),alarmsEvent=ev();
 const chunks=new Map();let tick=0;
 async function createZip(payload){
   let complete=payload.source==='api' && !payload.manifest.historyTruncated && !payload.unknownLinks.length;
   const files=(payload.assets||[]).map(a=>({id:a.id,filename:a.filename,status:a.url?'salvato':'non_recuperato'}));
   if(files.some(f=>f.status!=='salvato'))complete=false;
   const entries=payload.textFiles.map(f=>({name:`snapshot/${payload.snapshotFolder}/${f.name}`,text:f.text}));
   entries.push({name:`snapshot/${payload.snapshotFolder}/stato_backup.json`,text:JSON.stringify({result:complete?'COMPLETO':'PARZIALE',assets:files})});
   for(const f of files.filter(x=>x.status==='salvato'))entries.push({name:`allegati/${f.filename}`,text:'original file for '+f.id});
   const blob=await zip.create(entries);const buf=Buffer.from(await blob.arrayBuffer());
   chunks.set(String(++tick),buf);
   return {ok:true,token:String(tick),size:buf.length,complete,files,savedFiles:entries.length};
 }
 const chrome={
    runtime:{onMessage:msgEvent,onInstalled:installEvent,onStartup:startupEvent,lastError:null,
      getURL:p=>`chrome-extension://${extid}/${p}`,
      getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
      async sendMessage(m){
        if(m.to==='CHATGUARD_ZIP'&&m.op==='CREATE')return createZip(m.payload);
        if(m.to==='CHATGUARD_ZIP'&&m.op==='READ'){
          const buf=chunks.get(m.payload.token);const n=buf.subarray(m.payload.offset,m.payload.offset+m.payload.length);
          return {ok:true,data:n.toString('base64'),bytes:n.length,total:buf.length};
        }
        if(m.to==='CHATGUARD_ZIP'&&m.op==='RELEASE'){chunks.delete(m.payload.token);return {ok:true}};
        return {ok:false,error:'Unsupported message'};
      },
      connectNative(name){
        assert.equal(name,'com.chatguard.local');started++;
        const p=spawn(host,[`chrome-extension://${extid}/`]);
        let data=Buffer.alloc(0);const nativeMessage=ev(),nativeDisconnect=ev();
        let disconnected=false;
        p.stdout.on('data',chunk=>{
          data=Buffer.concat([data,chunk]);
          while(data.length>=4){const n=data.readUInt32LE(0);if(data.length<4+n)break;
            const msg=JSON.parse(data.subarray(4,4+n).toString('utf8'));
            data=data.subarray(4+n);nativeMessage.fire(msg);
          }
        });
        p.on('close',code=>{disconnected=true;if(code!==0)chrome.runtime.lastError={message:'Native host has exited.'};nativeDisconnect.fire()});
        p.on('error',()=>{disconnected=true;chrome.runtime.lastError={message:'Specified native messaging host not found.'};nativeDisconnect.fire()});
        return {onMessage:nativeMessage,onDisconnect:nativeDisconnect,
          postMessage(m){if(disconnected)throw Error('Host disconnected');const raw=Buffer.from(JSON.stringify(m));const hdr=Buffer.alloc(4);hdr.writeUInt32LE(raw.length);p.stdin.write(Buffer.concat([hdr,raw]));},
          disconnect(){p.stdin.end()}};
      }
    },
    alarms:{onAlarm:alarmsEvent,async clear(){},async create(){}},
    offscreen:{async createDocument(){}},
    scripting:{async executeScript(){}},
    tabs:{async query(){return[]},async sendMessage(tab,m){if(m.type==='RESOLVE_ASSETS')return {ok:true,assets:m.ids.map(id=>({id,url:`https://chatgpt.com/backend-api/files/${id}`}))};return{ok:false}}},
    storage:{local:{async get(keys){const obj={};for(const key of Array.isArray(keys)?keys:[keys])if(Object.hasOwn(store,key))obj[key]=store[key];return obj},async set(obj){Object.assign(store,obj)}}}
 };
 const ctx={chrome,ChatGuardLocal:lib,importScripts(){},crypto:crypto.webcrypto,TextEncoder,Uint8Array,JSON,Math,Map,Set,Date,URL,console,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'background.js'),'utf8'),ctx);
 async function send(msg){return new Promise(resolve=>{
   const ret=msgEvent.items[0](msg,{tab:{id:1,url:`https://chatgpt.com/c/${conv}`}},resolve);
   assert.equal(ret,true);
 })}
 return {send,chrome,store,savePath,temp,saved,started:()=>started,clean:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
function snap(n=2,{asset=false,source='api',reason='manuale'}={}){
 const mapping={};let parent=null;
 for(let i=0;i<n;i++){
   const id='node'+i, role=i%2?'assistant':'user';
   const message={id:'msg'+i,author:{role},create_time:1700000000+i,content:{parts:[i?'Risposta':'Ciao']}};
   if(i===0&&asset)message.metadata={attachments:[{id:'file_123456789abcdef0123456789ab',name:'documento.zip',mime_type:'application/zip'}]};
   mapping[id]={parent,message};parent=id;
 }
 const raw={mapping,current_node:parent};
 return {...lib.parseApiConversation(raw,conv),reason,captureTime:new Date().toISOString(),url:`https://chatgpt.com/c/${conv}`,source};
}

test('real native executable: successful snapshot, ZIP verify, no overwrite on unchanged input',{skip:!integration},async()=>{
  const x=fakeWorker();try{
    const status=await x.send({type:'GET_STATUS'});
    assert.equal(status.native.ok,true);
    assert.equal(status.native.root,x.savePath);
    const first=await x.send({type:'SAVE_SNAPSHOT',snapshot:snap(2,{asset:true})});
    assert.equal(first.ok,true,first.error);
    assert.equal(first.complete,true);
    const files=fs.readdirSync(path.join(x.savePath,'ChatGPT_Backups'));
    assert.equal(files.length,1);
    const fn=fs.readdirSync(path.join(x.savePath,'ChatGPT_Backups',files[0]));
    assert.equal(fn.length,1);assert.match(fn[0],/^snapshot_.+\.zip$/);
    const second=await x.send({type:'SAVE_SNAPSHOT',snapshot:snap(2,{asset:true})});
    assert.equal(second.unchanged,true);
    assert.equal(fs.readdirSync(path.join(x.savePath,'ChatGPT_Backups',files[0])).length,1);
    const third=await x.send({type:'SAVE_SNAPSHOT',snapshot:snap(3,{asset:true})});
    assert.equal(third.ok,true,third.error);
    assert.equal(fs.readdirSync(path.join(x.savePath,'ChatGPT_Backups',files[0])).length,2);
    assert.equal(x.store.stats.snapshots,2);
  }finally{x.clean()}
});

test('failed origin: no successful backup and auto paused',{skip:!integration},async()=>{
  const x=fakeWorker({badID:true});try{
    const r=await x.send({type:'SAVE_SNAPSHOT',snapshot:snap()});
    assert.equal(r.ok,false);
    assert.match(r.error,/NON salvato/);
    assert.ok(x.store.automaticPaused);
    assert.equal(x.store.stats,undefined);
  }finally{x.clean()}
});

test('decreased history gets retained but marked partial',{skip:!integration},async()=>{
  const x=fakeWorker();try{
    const first=await x.send({type:'SAVE_SNAPSHOT',snapshot:snap(5)});
    assert.equal(first.ok,true,first.error);
    const second=await x.send({type:'SAVE_SNAPSHOT',snapshot:snap(2)});
    assert.equal(second.ok,true,second.error);
    assert.equal(second.complete,false);
    assert.match(second.warning,/accorciata/);
  }finally{x.clean()}
});

test('real native executable: multi-chunk transfer of a large conversation',{skip:!integration},async()=>{
  const x=fakeWorker();try{
    const input=snap(2);
    input.raw.mapping.node0.message.content.parts=[crypto.randomBytes(360000).toString('base64')];
    input.messages[0].text=input.raw.mapping.node0.message.content.parts[0];
    const result=await x.send({type:'SAVE_SNAPSHOT',snapshot:input});
    assert.equal(result.ok,true,result.error);
    assert.equal(result.complete,true);
    const sub=fs.readdirSync(path.join(x.savePath,'ChatGPT_Backups'))[0];
    const filename=fs.readdirSync(path.join(x.savePath,'ChatGPT_Backups',sub))[0];
    const stat=fs.statSync(path.join(x.savePath,'ChatGPT_Backups',sub,filename));
    assert.ok(stat.size>500000);
  }finally{x.clean()}
});
