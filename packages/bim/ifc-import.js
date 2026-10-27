/* IFC import/cache boundary. No cloud API, no viewer, no persistent object URLs. */
(function(root){
 'use strict';const VERSION='web-ifc-0.0.78/archgel-3',workerURL=new URL('ifc-worker.js?version='+encodeURIComponent(VERSION),document.currentScript.src).href;
 const aborted=()=>new DOMException('Importación IFC cancelada. El modelo anterior se conserva.','AbortError');
 const check=signal=>{if(signal?.aborted)throw aborted();};
 async function importFile({workspace,file,expectedRevision,signal,onProgress=()=>{}}){
  if(!(file instanceof Blob)||!file.size||! /\.ifc$/i.test(file.name||''))throw Error('Selecciona un archivo IFC (.ifc) exportado desde tu programa BIM.');
  check(signal);onProgress('Leyendo IFC del dispositivo…');const bytes=await file.arrayBuffer();check(signal);
  const head=new TextDecoder().decode(new Uint8Array(bytes,0,Math.min(bytes.byteLength,256)));if(!/^\s*\uFEFF?\s*ISO-10303-21\s*;/i.test(head))throw Error('El archivo no es un IFC STEP válido. No se admiten IFCZIP ni IFCXML en la importación local.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''),key=VERSION+':'+hash;
  check(signal);let draft=await workspace.load();if(expectedRevision!==undefined&&draft.localRevision!==expectedRevision)throw Error('Hay cambios de otra pestaña. Recarga antes de importar.');const revision=draft.localRevision,cache=draft.ifcImports?.[key];
  if(cache){try{await workspace.store.get(cache.ref);await workspace.store.get(cache.sourceRef);check(signal);onProgress('Usando la copia IFC ya preparada');return {...cache,cached:true,localRevision:revision};}catch(error){if(error.name==='AbortError')throw error;}}
  const converted=await new Promise((resolve,reject)=>{
   let worker,settled=false;const finish=(error,result)=>{if(settled)return;settled=true;worker?.terminate();signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);},cancel=()=>finish(aborted());
   try{check(signal);worker=new Worker(workerURL);signal?.addEventListener('abort',cancel,{once:true});worker.onerror=()=>finish(Error('No se pudo preparar el IFC. Revisa la memoria disponible y vuelve a intentar.'));worker.onmessage=({data})=>{if(data.type==='progress')onProgress(data.stage+(data.total?' · '+Math.round(100*data.done/data.total)+'%':''));else if(data.type==='error')finish(Error(data.message));else if(data.type==='done')finish(null,data);};worker.postMessage({type:'convert',bytes},[bytes]);}catch(error){finish(error);}
  });
  check(signal);draft=await workspace.load();if(draft.localRevision!==revision)throw Error('Hay cambios de otra pestaña durante la importación. El modelo anterior se conserva.');
  onProgress('Guardando IFC y copia preparada en este dispositivo…');
  let source,visual;
  try{
   source=await workspace.store.put(file,{kind:'ifc'});check(signal);
   visual=await workspace.store.put(new File([converted.bytes],file.name.replace(/\.ifc$/i,'.glb'),{type:'model/gltf-binary'}),{kind:'glb'});check(signal);
   const result={ref:visual.ref,sourceRef:source.ref,summary:converted.summary,version:VERSION,fingerprint:hash};
   draft.media.push({...source,ifcFingerprint:hash},{...visual,ifcFingerprint:hash});draft.ifcImports={...draft.ifcImports,[key]:result};await workspace.save(draft);check(signal);
   return {...result,cached:false,localRevision:draft.localRevision};
  }catch(error){
   // Only roll back copies from this job. A save may commit just before an account change.
   const persisted=await workspace.store.loadDraft().catch(()=>null),committed=visual&&persisted?.ifcImports?.[key]?.ref===visual.ref;
   if(!committed)for(const m of [visual,source])if(m)await workspace.store.removeLocal(m.ref).catch(()=>{});
   throw error;
  }
 }
 root.AgelIFC={importFile,VERSION};
})(window);
