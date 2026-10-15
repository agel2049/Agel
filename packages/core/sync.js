(function(root){
 'use strict';
 const refs=value=>{const out=new Set();function walk(v){if(typeof v==='string'&&v.startsWith('agel-local:'))out.add(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);}walk(value);return [...out];};
 const payload=d=>({tree:d.tree,spaces:d.spaces,showroom:d.showroom,privateSettings:d.privateSettings});
 async function plan(snapshot,store){
  const assets=[],blocked=[];for(const ref of refs(payload(snapshot))){
   try{const m=await store.get(ref),bucket=m.kind==='model_html'?'models':'media',cap=bucket==='models'?33554432:16777216;
    const allowed=bucket==='models'?['text/html']:['image/jpeg','image/png','image/webp','image/avif','image/gif','video/mp4','video/webm','application/pdf','model/gltf-binary','application/json'];
    if(m.bytes<=0||m.bytes>cap)blocked.push(`${m.name}: supera el límite nube de ${cap/1048576} MiB. Conserva el original local y usa una copia optimizada.`);
    if(!allowed.includes(m.mime))blocked.push(`${m.name}: formato disponible solo en este dispositivo.`);
    assets.push({...m,bucket});
   }catch(e){blocked.push(e.message);}
  }return {assets,totalBytes:assets.reduce((n,a)=>n+(a.cloud?0:a.bytes),0),blocked};
 }
 function rewrite(v,mapping){if(typeof v==='string')return mapping.get(v)||v;if(Array.isArray(v))return v.map(x=>rewrite(x,mapping));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x,mapping)]));return v;}
 async function run({workspace,cloud,signal,onProgress=()=>{}}){
  const initial=await workspace.load(),p=await plan(initial,workspace.store);if(p.blocked.length)throw Error(p.blocked.join('\n'));
  const stopped=()=>{if(signal?.aborted)throw Error('Sincronización pausada. Puedes reintentar; los archivos completados se conservan.');};
  const journal=await root.AgelSyncJournal.open(workspace),mapping=new Map();let i=0;
  for(const asset of p.assets){stopped();onProgress(`Archivo ${++i} de ${p.assets.length}: ${asset.name}`);
   let completed=asset.cloud;
   if(!completed){
    let reservation=await journal.get(asset.id);
    if(!reservation){reservation=await cloud.rpc('begin_sync_asset',{p_project:workspace.projectId,p_local_id:asset.id,p_bucket:asset.bucket,p_kind:asset.kind,p_filename:asset.name,p_bytes:asset.bytes,p_mime:asset.mime});await journal.save(asset.id,reservation);}
    // Ask the server first: a previous transfer may have finished before the client lost its response.
    completed=await cloud.rpc('complete_sync_asset',{p_asset:reservation.asset_id});
    if(completed.status!=='ready'){
     stopped();await cloud.transferReserved(reservation,asset.blob,{signal});
     completed=await cloud.rpc('complete_sync_asset',{p_asset:reservation.asset_id});
    }
    if(completed.status!=='ready')throw Error('La nube todavía no confirmó el archivo. Reintenta sin volver a seleccionarlo.');
    completed={...completed,url:completed.url||cloud.publicUrl(completed.bucket,completed.path)};
    await workspace.store.markSynced(asset.ref,completed);
   }mapping.set(asset.ref,completed.url);
  }
  stopped();const fresh=await workspace.load();if(fresh.localRevision!==initial.localRevision)throw Error('Hay cambios de otra pestaña durante la subida. Reintenta para sincronizar el borrador actual.');
  const snapshot=rewrite(payload(initial),mapping);onProgress('Guardando contenido en la nube…');
  const result=await cloud.rpc('save_workspace_snapshot',{p_project:workspace.projectId,p_snapshot:snapshot,p_base_revision:initial.baseRevision});
  const next={...initial,...snapshot,baseRevision:result.revision};next.tree.revision=result.revision;
  await workspace.save(next,{synced:true});onProgress('Contenido sincronizado');return result;
 }
 root.AgelSyncJournal={async open({ownerId,projectId}){const s=await AgelLocalMedia.open({ownerId,projectId});return {save:(id,r)=>s.saveJob(id,r),get:id=>s.getJob(id)};}};
 root.AgelSync={plan,run};
})(window);
