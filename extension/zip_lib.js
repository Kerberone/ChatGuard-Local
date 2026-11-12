/* Tiny ZIP writer (STORE, UTF-8) for local browser backups. No compression and no dependencies. */
(function(root,factory){
  const api=factory();root.ChatGuardZip=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const enc=new TextEncoder();
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    table[n]=c>>>0;
  }
  function crc32Update(state,arr){
    let crc=state;
    for(const b of arr)crc=table[(crc^b)&255]^(crc>>>8);
    return crc>>>0;
  }
  function put16(v,x,off){v.setUint16(off,x,true)}
  function put32(v,x,off){v.setUint32(off,x>>>0,true)}
  function zipDate(date){
    const year=Math.min(2107,Math.max(1980,date.getFullYear()));
    return {t: ((date.getHours()&31)<<11)|((date.getMinutes()&63)<<5)|(Math.floor(date.getSeconds()/2)&31),
      d:((year-1980)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31)};
  }
  // Each input: {name,blob} or {name,text}. ZIP entry CRC uses bounded chunks.
  async function create(entries){
    const body=[],central=[];let offset=0,centralSize=0;
    const dt=zipDate(new Date());
    for(const entry of entries){
      const name=String(entry.name||'').replace(/\\/g,'/');
      if(!name||name.startsWith('/')||name.split('/').some(p=>p==='..'))throw new Error('Percorso ZIP non valido');
      const filename=enc.encode(name);
      if(filename.length>65535)throw new Error('Nome troppo lungo per ZIP');
      const blob=entry.blob instanceof Blob?entry.blob:new Blob([entry.text??''],{type:'application/octet-stream'});
      if(blob.size>0xffffffff)throw new Error('Un allegato supera il limite ZIP di 4 GB');
      let state=0xffffffff;
      for await(const chunk of blob.stream()) state=crc32Update(state,chunk);
      const crc=(state^0xffffffff)>>>0;
      const local=new ArrayBuffer(30+filename.length),lv=new DataView(local);
      put32(lv,0x04034b50,0);put16(lv,20,4);put16(lv,0x800,6);put16(lv,0,8);
      put16(lv,dt.t,10);put16(lv,dt.d,12);put32(lv,crc,14);
      put32(lv,blob.size,18);put32(lv,blob.size,22);put16(lv,filename.length,26);put16(lv,0,28);
      new Uint8Array(local,30).set(filename);
      body.push(local,blob);
      const head=new ArrayBuffer(46+filename.length),cv=new DataView(head);
      put32(cv,0x02014b50,0);put16(cv,20,4);put16(cv,20,6);put16(cv,0x800,8);
      put16(cv,0,10);put16(cv,dt.t,12);put16(cv,dt.d,14);put32(cv,crc,16);
      put32(cv,blob.size,20);put32(cv,blob.size,24);put16(cv,filename.length,28);
      put16(cv,0,30);put16(cv,0,32);put16(cv,0,34);put16(cv,0,36);put32(cv,0,38);put32(cv,offset,42);
      new Uint8Array(head,46).set(filename);
      central.push(head);centralSize+=head.byteLength;
      offset+=local.byteLength+blob.size;
      if(offset>0xffffffff)throw new Error('Archivio troppo grande per il formato ZIP compatibile');
    }
    if(entries.length>65535)throw new Error('Troppi file nello ZIP');
    const eocd=new ArrayBuffer(22),ev=new DataView(eocd);
    put32(ev,0x06054b50,0);put16(ev,0,4);put16(ev,0,6);
    put16(ev,entries.length,8);put16(ev,entries.length,10);
    put32(ev,centralSize,12);put32(ev,offset,16);put16(ev,0,20);
    return new Blob([...body,...central,eocd],{type:'application/zip'});
  }
  return {create,crc32Update};
});
