/* Personal device storage. No network calls; object URLs are never persisted. */
(function(root){
 'use strict';let opening;
 const friendly=e=>new Error(e?.name==='QuotaExceededError'?'No hay espacio local suficiente. El archivo no se guardó; libera espacio o elige otra carpeta.':e?.message||'No se pudo guardar en este dispositivo');
 function database(){if(!opening)opening=new Promise((resolve,reject)=>{
  if(!root.indexedDB)return reject(new Error('Este navegador no ofrece almacenamiento local. Usa un navegador compatible o conserva tus archivos originales.'));
  const req=indexedDB.open('agelarq.local.v1',1);
  req.onupgradeneeded=()=>{for(const name of ['media','drafts','syncJobs']){const s=req.result.createObjectStore(name,{keyPath:['ownerId','projectId','id']});s.createIndex('project',['ownerId','projectId']);}};
  req.onerror=()=>{opening=null;reject(friendly(req.error));};req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
 });return opening;}
 async function open({ownerId,projectId}){
  if(!ownerId||!projectId)throw new Error('Falta identificar la cuenta y el proyecto local');
  const db=await database(),prefix=[ownerId,projectId];
  function transaction(name,mode,action){return new Promise((resolve,reject)=>{
   const tx=db.transaction(name,mode);let result,req;
   try{req=action(tx.objectStore(name));}catch(e){tx.abort();reject(friendly(e));return;}
   if(req)req.onsuccess=()=>result=req.result;
   tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(friendly(tx.error||req?.error));
  });}
  const idOf=ref=>{if(!/^agel-local:[\w-]+$/.test(ref||''))throw new Error('Referencia local inválida');return ref.slice(11);};
  const write=(name,id,data)=>transaction(name,'readwrite',s=>s.put({...data,ownerId,projectId,id,updatedAt:Date.now()}));
  const read=(name,id)=>transaction(name,'readonly',s=>s.get([...prefix,id]));
  const all=name=>transaction(name,'readonly',s=>s.index('project').getAll(IDBKeyRange.only(prefix)));
  return {
   ownerId,projectId,
   async put(blob,{id=crypto.randomUUID(),kind='image'}={}){
    if(!(blob instanceof Blob)||!/^[\w-]+$/.test(id))throw new Error('Archivo local inválido');
    const ref='agel-local:'+id,meta={ref,bytes:blob.size,mime:blob.type||'application/octet-stream',name:blob.name||'archivo',kind};
    await write('media',id,{...meta,blob});return meta;
   },
   async get(ref){const record=await read('media',idOf(ref));if(!record?.blob)throw new Error('Archivo local no disponible. Vuelve a seleccionarlo o restaura tu respaldo.');return record;},
   async list(){return (await all('media')).map(({blob,...meta})=>meta);},
   async markSynced(ref,cloud){const record=await this.get(ref);if(!/^https:\/\//.test(cloud?.url||''))throw new Error('La copia nube no es una dirección HTTPS');await write('media',record.id,{...record,cloud});},
   async removeLocal(ref){await transaction('media','readwrite',s=>s.delete([...prefix,idOf(ref)]));},
   async saveDraft(snapshot,expectedVersion){
    if(expectedVersion===undefined){await write('drafts','draft',{snapshot});return;}
    await new Promise((resolve,reject)=>{
     const tx=db.transaction('drafts','readwrite'),s=tx.objectStore('drafts'),req=s.get([...prefix,'draft']);let failure;
     req.onsuccess=()=>{if((req.result?.snapshot?.localRevision||0)!==expectedVersion){failure=Error('Hay cambios de otra pestaña. Vuelve a cargar el borrador antes de guardar.');tx.abort();return;}
      try{s.put({ownerId,projectId,id:'draft',snapshot,updatedAt:Date.now()});}catch(e){failure=friendly(e);tx.abort();}};
     tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(failure||friendly(tx.error));
    });
   },
   async loadDraft(){return (await read('drafts','draft'))?.snapshot||null;},
   async saveJob(id,job){await write('syncJobs',id,{job});},
   async getJob(id){return (await read('syncJobs',id))?.job||null;},
   async estimate(){return root.navigator.storage?.estimate?await navigator.storage.estimate():{usage:null,quota:null};},
   async persist(){return root.navigator.storage?.persist?await navigator.storage.persist():false;},
   async url(ref){if(/^https:\/\//.test(ref))return ref;return URL.createObjectURL((await this.get(ref)).blob);}
  };
 }
 root.AgelLocalMedia={open};
})(window);
