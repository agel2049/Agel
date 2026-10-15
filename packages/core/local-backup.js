(function(root){
 'use strict';
 const safe=s=>String(s).replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(-100)||'archivo';
 async function manifest(store,snapshot){const files=(await store.list()).map(m=>({id:m.id,ref:m.ref,name:m.name,path:m.id+'_'+safe(m.name),bytes:m.bytes,mime:m.mime,kind:m.kind}));
  return {format:'agelarq.local.backup',version:1,createdAt:new Date().toISOString(),snapshot:snapshot||await store.loadDraft(),files};}
 function download(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 async function exportProject(store,snapshot){
  // Ask for the directory before async work, retaining the user activation.
  const parent=root.showDirectoryPicker?await root.showDirectoryPicker({mode:'readwrite'}):null;
  const directory=parent?await parent.getDirectoryHandle(`agelarq-respaldo-${Date.now()}`,{create:true}):null;
  const data=await manifest(store,snapshot);
  if(directory){
   for(const f of data.files){const source=await store.get(f.ref),handle=await directory.getFileHandle(f.path,{create:true}),out=await handle.createWritable();await source.blob.stream().pipeTo(out);}
   const handle=await directory.getFileHandle('agelarq-respaldo.json',{create:true}),out=await handle.createWritable();await out.write(JSON.stringify(data));await out.close();
  }else{
   for(const f of data.files)download(f.path,(await store.get(f.ref)).blob);
   download('agelarq-respaldo.json',new Blob([JSON.stringify(data)],{type:'application/json'}));
  }return data;
 }
 async function importProject(store,data,files){
  if(data?.format!=='agelarq.local.backup'||data.version!==1||!Array.isArray(data.files)||data.files.length>10000)throw new Error('Respaldo local inválido');
  const byName=new Map([...files].map(f=>[f.name,f])),seen=new Set();
  for(const f of data.files){if(!/^[\w-]+$/.test(f.id)||seen.has(f.id))throw new Error('Identificador duplicado o inválido en respaldo');seen.add(f.id);
   const source=byName.get(f.path);if(!source||source.size!==f.bytes)throw new Error(`Falta el archivo completo «${f.name}»`);}
  const originalProject=data.snapshot?.tree?.project?.id;
  if(originalProject&&originalProject!==store.projectId)throw new Error('Este respaldo pertenece a otro proyecto. Ábrelo en su proyecto original.');
  // Restoring never overwrites existing media IDs. Rewrite only local references.
  const refs=new Map();
  for(const f of data.files){const file=new File([byName.get(f.path)],f.name,{type:f.mime});
   const meta=await store.put(file,{id:crypto.randomUUID(),kind:f.kind});refs.set(f.ref,meta.ref);}
  function rewrite(v){if(typeof v==='string')return refs.get(v)||v;if(Array.isArray(v))return v.map(rewrite);
   if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)]));return v;}
  await store.saveDraft(rewrite(data.snapshot));return {files:data.files.length};
 }
 root.AgelLocalBackup={manifest,exportProject,importProject};
})(window);
