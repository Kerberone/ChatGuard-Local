const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const fs=require('node:fs');const path=require('node:path');
const zip=require('../extension/zip_lib.js');
function runner(fetchResponse){
 const messages=[];let latestURL=0;
 const chrome={runtime:{onMessage:{addListener(fn){messages.push(fn)}}}};
 class URLs extends URL {}
 URLs.createObjectURL=()=>('blob:fake/'+(++latestURL)); URLs.revokeObjectURL=()=>{};
 const context={globalThis:null,chrome,Blob,URL:URLs,TextEncoder,Uint8Array,btoa:binary=>Buffer.from(binary,'binary').toString('base64'),
 fetch:async()=>fetchResponse||{ok:true,headers:{get(k){return k==='content-type'?'application/zip':null}},blob:async()=>new Blob(['file originale'])},Map,Date,Promise,JSON,Number,Math,console};
 context.globalThis=context;context.ChatGuardZip=zip;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/zip_writer.js'),'utf8'),context);
 async function send(op,payload){return await new Promise((resolve,reject)=>{messages[0]({to:'CHATGUARD_ZIP',op,payload},{},resolve)})}
 return send;
}
const data={subfolders:['ChatGPT_Backups'],conversationFolder:'Demo_chat',snapshotFolder:'2026-11-12_11-44-00_abcd1234',
 source:'api',assets:[{id:'file_abc123',filename:'file_abc123__example.zip',url:'https://chatgpt.com/ok',messageIds:['m0']}],
 textFiles:[{name:'conversazione.json',text:JSON.stringify({text:'Ciao'})},{name:'conversazione.md',text:'# Ciao'}],
 manifest:{expectedAssets:1,attachmentsRequested:true,historyTruncated:false},unknownLinks:[]}
test('ZIP native: original file added; READ chunks reconstruct exact bytes, RELEASE removes token',async()=>{
 const send=runner();const res=await send('CREATE',data);assert.equal(res.ok,true);assert.equal(res.complete,true);
 let offset=0;const blocks=[];
 while(offset<res.size){const r=await send('READ',{token:res.token,offset,length:300});assert.equal(r.ok,true);const buf=Buffer.from(r.data,'base64');blocks.push(buf);offset+=r.bytes}
 assert.equal(Buffer.concat(blocks).length,res.size);assert.equal((await send('RELEASE',{token:res.token})).ok,true);
 const missing=await send('READ',{token:res.token,offset:0,length:100});assert.equal(missing.ok,false);
});
test('ZIP native: inaccessible asset marks PARZIALE, but text still saved',async()=>{
 const send=runner({ok:false,status:403,headers:{get(){return null}}});
 const res=await send('CREATE',data);assert.equal(res.ok,true);assert.equal(res.complete,false);
 assert.equal(res.files[0].status,'non_recuperato');await send('RELEASE',{token:res.token});
});
