/* Shared authoring/publication links. IDs are stable; invalid scope never means all. */
(function(root){
  'use strict';
  const str=(v,n=120)=>String(v??'').slice(0,n);
  const fail=message=>{throw new Error(message);};
  function normalizeSpaces(spaces,scenes){
    const valid=new Set(scenes.map(s=>s.id)),seen=new Set();
    return (spaces||[]).map(s=>{
      if(seen.has(s.id))fail('Identificador de espacio duplicado');seen.add(s.id);
      const refs=s.sceneIds||s.scene_ids||(s.scenes||[]).map(i=>scenes[i]?.id);
      return {...s,sceneIds:[...new Set(refs.filter(id=>valid.has(id)))]};
    });
  }
  function sceneIdsForScope(spaceId,spaces,scenes){
    const valid=new Set(scenes.map(s=>s.id));if(spaceId===null)return [...valid];
    const byId=new Map(spaces.map(s=>[s.id,s]));if(!byId.has(spaceId))return [];
    const normalized=normalizeSpaces(spaces,scenes),ids=new Set(),visited=new Set(),queue=[spaceId];
    while(queue.length){const id=queue.shift();if(visited.has(id))fail('Jerarquía cíclica');visited.add(id);
      const s=normalized.find(s=>s.id===id);for(const sid of s?.sceneIds||[])ids.add(sid);
      for(const c of normalized)if(c.parent_id===id)queue.push(c.id);
    }return [...ids];
  }
  function media(ref,publicMode){
    if(!ref)return '';
    if(/^agel-local:[\w-]+$/.test(ref)){if(publicMode)fail('Archivo local pendiente de sincronización');return ref;}
    try{const u=new URL(ref);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href;}catch{}
    fail('La dirección del archivo debe ser HTTPS');
  }
  function normalizeExperience(raw={},spaces=[],scenes=[],{publicMode=true}={}){
    const source=raw.views||[];if(!Array.isArray(source)||source.length>256)fail('Máximo 256 vistas por proyecto');
    const bySpace=new Set(spaces.map(s=>s.id)),byScene=new Set(scenes.map(s=>s.id)),seen=new Set();
    const pct=n=>{n=Number(n);if(!Number.isFinite(n)||n<0||n>100)fail('Coordenada fuera de la imagen');return n;};
    const views=source.map((v,i)=>{
      const id=str(v.id||`v${i+1}`,40);if(!/^[\w-]+$/.test(id)||seen.has(id))fail('Identificador de vista inválido o duplicado');seen.add(id);
      const spaceId=v.spaceId||null;if(spaceId&&!bySpace.has(spaceId))fail('La vista apunta a un espacio inexistente');
      const scope=new Set(sceneIdsForScope(spaceId,spaces,scenes));
      const regions=(v.regions||[]).map((r,j)=>{
        if(r.space&&!bySpace.has(r.space))fail('Zona de espacio inexistente');
        if(!Array.isArray(r.points)||r.points.length<3||r.points.length>80)fail('La zona necesita entre 3 y 80 vértices');
        const radius=Number(r.radius||0);if(!Number.isFinite(radius)||radius<0||radius>2)fail('Radio de esquina fuera del intervalo 0–2');
        let target=r.target||(r.space?{type:'space',id:r.space}:null);
        if(target){target={type:target.type,id:str(target.id,40)};
          if(!['view','scene','space'].includes(target.type))fail('Tipo de destino inválido');
          if(target.type==='space'&&!bySpace.has(target.id))fail('Destino de espacio inexistente');
          if(target.type==='scene'&&!scope.has(target.id))fail('Destino de escena fuera del alcance');
        }
        return {id:str(r.id||`${id}-r${j}`,60),space:r.space||null,points:r.points.map(p=>[pct(p[0]),pct(p[1])]),radius,target};
      });
      const spots=(v.spots||[]).map(sp=>{
        const sid=sp.sceneId||sp.scene;
        if(!byScene.has(sid)||!scope.has(sid))fail('Escena fuera del alcance de esta planta');
        return {scene:sid,x:pct(sp.x),y:pct(sp.y)};
      });
      const w=Number(v.w)||1600,h=Number(v.h)||900;
      if(w<=0||h<=0||w>20000||h>20000)fail('Dimensiones de imagen inválidas');
      return {id,title:str(v.title||`Vista ${i+1}`,80),kind:v.kind==='plano'?'plano':'render',
        role:['facade','lobby','floor','unit'].includes(v.role)?v.role:(v.kind==='plano'?'floor':'facade'),
        spaceId,image:media(v.image,publicMode),w,h,ratio:w/h,regions,spots};
    });
    for(const v of views)for(const r of v.regions)if(r.target?.type==='view'&&!seen.has(r.target.id))fail('Destino de vista inexistente');
    const e=raw.experience||{},version=e.version===1?1:0;
    if(version&&!seen.has(e.facadeViewId))fail('Selecciona una fachada válida');
    if(e.entryTargetViewId&&(!seen.has(e.entryTargetViewId)||e.entryTargetViewId===e.facadeViewId))fail('La entrada debe apuntar a otra planta válida');
    const experience={version,facadeViewId:e.facadeViewId||null,entryTargetViewId:e.entryTargetViewId||null,
      entrance:{x:pct(e.entrance?.x??50),y:pct(e.entrance?.y??70),label:str(e.entrance?.label||'Entrar al lobby',80)}};
    const o=raw.opening||{};
    const opening={enabled:o.enabled??!!(o.video||o.videoUrl),video:media(o.video||o.videoUrl,publicMode),
      poster:media(o.poster,publicMode),title:str(o.title,160),subtitle:str(o.subtitle||o.sub,240),
      button:str(o.button||o.btn||o.btnText||'Ver proyecto',60)};
    return {experience,views,opening,problems:[]};
  }
  const api={normalizeSpaces,sceneIdsForScope,normalizeExperience,media};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelShowroomRelations=api;
})(typeof window!=='undefined'?window:globalThis);
