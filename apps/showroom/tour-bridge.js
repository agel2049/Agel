(function(root){
 'use strict';const R=typeof require==='function'?require('../../packages/showroom/relations.js'):root.AgelShowroomRelations;
 function context(m,sceneId,spaceId){
  const spaces=R.normalizeSpaces(m.spaces,m.scenes),ids=new Set(R.sceneIdsForScope(spaceId??null,spaces,m.scenes)),index=m.scenes.findIndex(s=>s.id===sceneId);
  if(index<0||!ids.has(sceneId))throw Error('Escena fuera del alcance del departamento');
  const subset=m.scenes.flatMap((s,i)=>ids.has(s.id)?[i]:[]),allowed=new Set(subset),candidates=[];let space=spaces.find(s=>s.id===spaceId),seen=new Set();
  while(space&&!seen.has(space.id)){seen.add(space.id);candidates.push(...m.content.views.filter(v=>v.spaceId===space.id));space=spaces.find(s=>s.id===space.parent_id);}
  const mapViews=candidates.map(v=>({...v,spots:(v.spots||[]).filter(sp=>allowed.has(typeof sp.scene==='number'?sp.scene:m.scenes.findIndex(s=>s.id===(sp.sceneId||sp.scene)))).map(sp=>({...sp,scene:typeof sp.scene==='number'?sp.scene:m.scenes.findIndex(s=>s.id===(sp.sceneId||sp.scene))}))})).filter(v=>v.spots.length);
  return {index,subset,fromUnit:spaceId||null,mapViews};
 }
 function open({manifest,sceneId,spaceId,onClose=()=>{},onSceneChange=()=>{},openExisting}){
  const c=context(manifest,sceneId,spaceId);let closed=false,renderer;
  const done=()=>{if(closed)return;closed=true;onClose();};
  renderer=openExisting(c.index,c.subset,c.fromUnit,{autoMap:true,mapViews:c.mapViews,onClose:done,onSceneChange:i=>onSceneChange(manifest.scenes[i]?.id),immersive:true});
  return {close(){if(closed)return;renderer?.close();done();}};
 }
 const api={context,open};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelTourBridge=api;
})(typeof window!=='undefined'?window:globalThis);
