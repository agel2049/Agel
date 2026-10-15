/* Local authoring boundary. Cloud content is a base, never an autosave target. */
(function(root){
 'use strict';
 const clone=x=>structuredClone(x);
 async function open({cloud,ownerId,projectId}){
  let closed=false,current,urls=new Map();
  const store=await AgelLocalMedia.open({ownerId,projectId});
  const check=()=>{if(closed||cloud.user?.id!==ownerId)throw Error('La cuenta cambió. Vuelve a abrir el proyecto.');};
  check();current=await store.loadDraft();
  if(!current){
   const [tree,spaces]=await Promise.all([cloud.rpc('load_project_tree',{p_project:projectId}),cloud.select('spaces',`project_id=eq.${projectId}&select=*&order=position.asc`)]);
   check();current={tree,spaces,showroom:clone(tree.project.showroom||{}),privateSettings:{},media:[],baseRevision:tree.revision,localRevision:0,dirty:false};
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
   async addMedia(file,kind='image'){
    check();const draft=await api.load();if(!['owner','editor'].includes(draft.tree.role))throw Error('No tienes permiso para editar');
    const meta=await store.put(file,{kind});draft.media.push(meta);await api.save(draft);return meta;
   },
   async updateSpace(row){const d=await api.load(),i=d.spaces.findIndex(x=>x.id===row.id);const next={...(i<0?{}:d.spaces[i]),...clone(row),id:row.id||crypto.randomUUID(),project_id:projectId};
    if(next.parent_id&&!d.spaces.some(x=>x.id===next.parent_id&&x.id!==next.id))throw Error('El espacio padre no pertenece al proyecto');
    if(i<0)d.spaces.push(next);else d.spaces[i]=next;await api.save(d);return next;},
   async deleteSpace(id){const d=await api.load();if(d.spaces.some(x=>x.parent_id===id))throw Error('Mueve primero los espacios de este grupo');d.spaces=d.spaces.filter(x=>x.id!==id);await api.save(d);},
   async importCatalog(catalog){
    if(catalog.problems?.length)throw Error(catalog.problems.join('\n'));
    const d=await api.load(),groups=new Map(),levels=new Map();let created=0,updated=0;
    function ensure(kind,name,parent){const found=d.spaces.filter(x=>x.kind===kind&&x.name===name&&(x.parent_id||null)===(parent||null));if(found.length>1)throw Error('Hay grupos ambiguos: '+name);if(found.length)return found[0].id;
     const id=crypto.randomUUID();d.spaces.push({id,project_id:projectId,kind,name,parent_id:parent||null,scene_ids:[]});created++;return id;}
    for(const g of catalog.groups)groups.set(g.key,ensure('edificio',g.name,null));
    for(const l of catalog.levels)levels.set(l.key,ensure('nivel',l.name,groups.get(l.groupKey)));
    for(const u of catalog.units){const matches=d.spaces.filter(x=>x.code===u.data.code);if(matches.length>1)throw Error('Código ambiguo: '+u.data.code);
     const row={...clone(u.data),parent_id:levels.get(u.levelKey)||groups.get(u.groupKey)||null};
     if(matches.length){Object.assign(matches[0],row);updated++;}else{d.spaces.push({...row,id:crypto.randomUUID(),project_id:projectId,scene_ids:[]});created++;}}
    await api.save(d);return {created,updated};
   },
   async resolveMedia(ref){check();if(!ref?.startsWith('agel-local:'))return ref||'';if(!urls.has(ref))urls.set(ref,await store.url(ref));check();return urls.get(ref);},
   close(){closed=true;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();}
  };return api;
 }
 root.AgelWorkspace={open};
})(window);
