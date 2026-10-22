/* Local authoring boundary. Cloud content is a base, never an autosave target. */
(function(root){
 'use strict';
 const clone=x=>structuredClone(x);
 const assertRevision=(draft,expected)=>{if(expected!==undefined&&draft.localRevision!==expected)throw Error('Hay cambios de otra pestaña. Vuelve a cargar el borrador antes de guardar.');};
 async function open({cloud,ownerId,projectId}){
  let closed=false,current,urls=new Map(),closeListeners=new Set();
  const store=await AgelLocalMedia.open({ownerId,projectId});
  const check=()=>{if(closed||cloud.user?.id!==ownerId)throw Error('La cuenta cambió. Vuelve a abrir el proyecto.');};
  check();current=await store.loadDraft();
  if(!current){
   const [tree,spaces,privateSettings]=await Promise.all([cloud.rpc('load_project_tree',{p_project:projectId}),cloud.select('spaces',`project_id=eq.${projectId}&select=*&order=position.asc`),cloud.rpc('load_workspace_settings',{p_project:projectId})]);
   check();current={tree,spaces,showroom:clone(tree.project.showroom||{}),privateSettings:privateSettings||{},media:[],baseRevision:tree.revision,localRevision:0,dirty:false};
  }
  const api={ownerId,projectId,cloud,store,
   get dirty(){return current.dirty;},get baseRevision(){return current.baseRevision;},
   async load(){check();current=await store.loadDraft()||current;return clone(current);},
   async save(next,{synced=false}={}){
    check();if(!['owner','editor'].includes(current.tree.role))throw Error('No tienes permiso para editar este proyecto');
    if(next.tree?.project?.id!==projectId)throw Error('El borrador pertenece a otro proyecto');
    const expected=next.localRevision||0,copy=clone(next);copy.localRevision=expected+1;copy.dirty=!synced;
    await store.saveDraft(copy,expected);check();current=copy;next.localRevision=copy.localRevision;next.dirty=copy.dirty;return clone(copy);
   },
   async reloadCloud(){check();const [tree,spaces,privateSettings]=await Promise.all([cloud.rpc('load_project_tree',{p_project:projectId}),cloud.select('spaces',`project_id=eq.${projectId}&select=*&order=position.asc`),cloud.rpc('load_workspace_settings',{p_project:projectId})]);const previous=await api.load();const next={tree,spaces,showroom:clone(tree.project.showroom||{}),privateSettings,media:previous.media,baseRevision:tree.revision,localRevision:previous.localRevision,dirty:false};await api.save(next,{synced:true});return api.load();},
   async addMedia(file,kind='image',{expectedRevision}={}){
    check();const draft=await api.load();assertRevision(draft,expectedRevision);if(!['owner','editor'].includes(draft.tree.role))throw Error('No tienes permiso para editar');
    const meta=await store.put(file,{kind});draft.media.push(meta);await api.save(draft);return {...meta,localRevision:draft.localRevision};
   },
   async updateSpace(row,{expectedRevision}={}){const d=await api.load();assertRevision(d,expectedRevision);const i=d.spaces.findIndex(x=>x.id===row.id);const next={...(i<0?{}:d.spaces[i]),...clone(row),id:row.id||crypto.randomUUID(),project_id:projectId};
    if(next.parent_id&&!d.spaces.some(x=>x.id===next.parent_id&&x.id!==next.id))throw Error('El espacio padre no pertenece al proyecto');
    const ancestors=new Set([next.id]);let parent=next.parent_id;while(parent){if(ancestors.has(parent))throw Error('No puedes mover un espacio dentro de su descendiente: jerarquía cíclica');ancestors.add(parent);parent=d.spaces.find(x=>x.id===parent)?.parent_id;}
    if(i<0)d.spaces.push(next);else d.spaces[i]=next;await api.save(d);return next;},
   async deleteSpace(id,{expectedRevision}={}){const d=await api.load();assertRevision(d,expectedRevision);if(d.spaces.some(x=>x.parent_id===id))throw Error('Mueve primero los espacios de este grupo');d.spaces=d.spaces.filter(x=>x.id!==id);await api.save(d);},
   async importCatalog(catalog,{expectedRevision}={}){
    if(catalog.problems?.length)throw Error(catalog.problems.join('\n'));
    const d=await api.load();assertRevision(d,expectedRevision);const groups=new Map(),levels=new Map();let created=0,updated=0;
    function ensure(kind,name,parent){const found=d.spaces.filter(x=>x.kind===kind&&x.name===name&&(x.parent_id||null)===(parent||null));if(found.length>1)throw Error('Hay grupos ambiguos: '+name);if(found.length)return found[0].id;
     const id=crypto.randomUUID();d.spaces.push({id,project_id:projectId,kind,name,parent_id:parent||null,scene_ids:[]});created++;return id;}
    for(const g of catalog.groups)groups.set(g.key,ensure('edificio',g.name,null));
    for(const l of catalog.levels)levels.set(l.key,ensure('nivel',l.name,groups.get(l.groupKey)));
    for(const u of catalog.units){const matches=d.spaces.filter(x=>x.code===u.data.code);if(matches.length>1)throw Error('Código ambiguo: '+u.data.code);
     const row={...clone(u.data),parent_id:levels.get(u.levelKey)||groups.get(u.groupKey)||null};
     if(matches.length){Object.assign(matches[0],row);updated++;}else{d.spaces.push({...row,id:crypto.randomUUID(),project_id:projectId,scene_ids:[]});created++;}}
    await api.save(d);return {created,updated};
   },
   async previewManifest(){
    const d=await api.load(),scenes=d.tree.scenes.filter(s=>s.pano_url),idx=new Map(scenes.map((s,i)=>[s.id,i]));
    const raw={v:3,p:d.tree.project.name,sub:d.tree.project.subtitle,project:d.tree.project,branding:{},showroom:d.showroom,opening:d.showroom.opening,
     scenes:scenes.map(s=>({...s,url:s.pano_url,thumb:s.thumb_url,preview:s.preview_url,hs:(s.hs||[]).map(h=>({...h,img:h.img_url,targetScene:idx.get(h.target_scene_id)}))})),
     spaces:d.spaces.map(s=>({...s,price:s.show_price?s.price:null,currency:s.show_price?s.currency:null,scenes:(s.scene_ids||[]).map(id=>idx.get(id)).filter(i=>i!==undefined)}))};
    // Normalize first using safe HTTPS placeholders. Resolve only refs we own, after validation.
    const refs=new Map();function mask(v){if(typeof v==='string'&&v.startsWith('agel-local:')){const ext=d.media.find(m=>m.ref===v)?.kind==='glb'?'.glb':'';const key='https://agel-local.invalid/'+v.slice(11)+ext;refs.set(key,v);return key;}if(Array.isArray(v))return v.map(mask);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,mask(x)]));return v;}
    const m=sanitizeShowroom(mask(raw));async function resolve(v){if(typeof v==='string'&&refs.has(v))return api.resolveMedia(refs.get(v));if(Array.isArray(v))return Promise.all(v.map(resolve));if(v&&typeof v==='object')return Object.fromEntries(await Promise.all(Object.entries(v).map(async([k,x])=>[k,await resolve(x)])));return v;}
    return resolve(m);
   },
   // A session freezes only the commercial, schema-approved fields and referenced files.
   async sharePackage(){
    const d=await api.load(),refs=new Map(),local=new Map(d.media.map(m=>[m.ref,m]));
    const scenes=d.tree.scenes.filter(s=>s.pano_url),idx=new Map(scenes.map((s,i)=>[s.id,i]));
    const raw={v:3,p:d.tree.project.name,sub:d.tree.project.subtitle,project:d.tree.project,showroom:{...d.showroom,model3d:null},opening:d.showroom.opening,
     scenes:scenes.map(s=>({...s,url:s.pano_url,thumb:s.thumb_url,preview:s.preview_url,hs:(s.hs||[]).map(h=>({...h,img:h.img_url,targetScene:idx.get(h.target_scene_id)}))})),
     spaces:d.spaces.map(s=>({...s,price:s.show_price?s.price:null,currency:s.show_price?s.currency:null,scenes:(s.scene_ids||[]).map(id=>idx.get(id)).filter(i=>i!==undefined)}))};
    function extension(meta,url=''){
     const byMime={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/webm':'webm','model/gltf-binary':'glb','application/pdf':'pdf'};
     return byMime[meta?.mime]||(meta?.kind==='glb'?'glb':null)||(/\.(jpg|jpeg|png|webp|gif|avif|mp4|webm|glb|pdf)(?:[?#]|$)/i.exec(meta?.name||url)?.[1]?.toLowerCase())||'jpg';
    }
    const isModel=(meta,url='')=>meta?.kind==='glb'||/model\/gltf|gltf/i.test(meta?.mime||'')||/\.(glb|gltf)(?:[?#]|$)/i.test(meta?.name||url);
    const model=d.showroom.model3d;const remoteModel=model?.url&&isModel(local.get(model.url),model.url)?{available:true,title:String(model.title||'Maqueta virtual').slice(0,120)}:null;
    function mask(v){if(typeof v==='string'&&v.startsWith('agel-local:')){if(isModel(local.get(v)))return null;if(!local.has(v))throw Error('Falta un archivo local del showroom. Vuelve a seleccionarlo.');const u='https://agel-local.invalid/'+v.slice(11)+'.'+extension(local.get(v));refs.set(u,v);return u;}if(Array.isArray(v))return v.map(mask);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,mask(x)]));return v;}
    const m=sanitizeShowroom(mask(raw)),assets=new Map(),mapped=new Map(),pendingReads=new Set();let packageClosed=false;
    const checkPackage=()=>{check();if(packageClosed)throw Error('La sesión compartida se cerró.');};
    const closePackage=()=>{if(packageClosed)return;packageClosed=true;for(const controller of pendingReads)controller.abort();pendingReads.clear();closeListeners.delete(closePackage);};closeListeners.add(closePackage);
    const mediaKeys=new Set(['url','thumb','preview','image','img','poster','logo','video','videoUrl','endingVideoUrl','plan_url']);
    function asset(url){
     if(mapped.has(url))return mapped.get(url);if(isModel(null,url))return null;
     const ref=refs.get(url),u=new URL(url);
     if(!ref&&(u.protocol!=='https:'||u.username||u.password))throw Error('Archivo del showroom no permitido');
     const id=crypto.randomUUID(),ext=extension(local.get(ref),url),placeholder='https://agel-share.invalid/'+id+'.'+ext;
     // Closure captures a frozen reference; the receiver never supplies a source URL.
     assets.set(id,{getBlob:async()=>{
      checkPackage();let blob;
      if(ref)blob=(await store.get(ref)).blob;
      else{const controller=new AbortController();pendingReads.add(controller);try{const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw Error('Archivo del showroom no disponible');if(/gltf/i.test(response.headers.get('Content-Type')||''))throw Error('El modelo original no se comparte.');blob=await response.blob();}finally{pendingReads.delete(controller);}}
      checkPackage();if(/gltf/i.test(blob.type))throw Error('El modelo original no se comparte; usa la maqueta transmitida.');const head=await blob.slice(0,4).arrayBuffer();if(head.byteLength===4&&new DataView(head).getUint32(0,true)===0x46546c67)throw Error('El archivo GLB original no se comparte.');checkPackage();return blob;
     }});
     mapped.set(url,placeholder);return placeholder;
    }
    function exportMedia(v,key){if(typeof v==='string'&&mediaKeys.has(key)&&/^https:\/\//i.test(v))return asset(v);if(Array.isArray(v))return v.map(x=>exportMedia(x,key));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,exportMedia(x,k)]));return v;}
    try{const clean=exportMedia(m);
    // The wire format is raw schema input, never the normalized model or the draft.
    const views=clean.content.views.map(v=>({...v,w:v.w||Math.round(v.ratio*1000),h:v.h||1000,spots:v.spots.map(sp=>({...sp,scene:sp.sceneId||clean.scenes[sp.scene]?.id}))}));
    const snapshot={v:3,p:clean.title,sub:clean.subtitle,project:clean.project,branding:{...clean.brand,logo_url:clean.brand.logo},
     scenes:clean.scenes.map(s=>({...s,hs:s.hs.map(h=>({...h,payload:h.presentation?{showroomMarker:h.presentation}:undefined}))})),spaces:clean.spaces,opening:clean.opening,
     showroom:{...clean.content,views,opening:clean.opening,area_label:({ 'Superficie interior':'interior','Superficie total':'total','Superficie construida':'construida','Terreno':'terreno','Superficie útil':'util'})[clean.content.area_label]}};
    check();return {snapshot,assets,remoteModel,close:closePackage};}catch(e){closePackage();throw e;}
   },
   onClose(fn){closeListeners.add(fn);return()=>closeListeners.delete(fn);},
   async resolveMedia(ref){check();if(!ref?.startsWith('agel-local:'))return ref||'';if(!urls.has(ref))urls.set(ref,await store.url(ref));check();return urls.get(ref);},
   close(){if(closed)return;closed=true;for(const fn of closeListeners){try{fn();}catch{}}closeListeners.clear();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();}
  };return api;
 }
 root.AgelWorkspace={open};
})(window);
