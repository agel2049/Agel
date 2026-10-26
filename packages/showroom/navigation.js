(function(root){
 'use strict';const R=typeof require==='function'?require('./relations.js'):root.AgelShowroomRelations;
 function create(m){
  const views=m.content.views||[],spaces=R.normalizeSpaces(m.spaces||[],m.scenes||[]),e=m.content.experience||{};
  const facade=views.find(v=>v.id===e.facadeViewId)||views.find(v=>v.role==='facade')||views[0],listeners=new Set(),stack=[];
  const base=()=>({kind:'facade',viewId:facade?.id||null,spaceId:null,sceneId:null,error:null});
  let state=m.opening?.enabled?{...base(),kind:'opening'}:base();
  const notify=()=>listeners.forEach(fn=>fn({...state}));
  function transition(next,record=true){if(record)stack.push({...state});state={...next,error:null};notify();return true;}
  const reject=()=>{state={...state,error:'Este destino ya no está disponible. Puedes volver a la fachada.'};notify();return false;};
  const api={get state(){return {...state};},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
   dispatch(a){
    if(a.type==='BACK')return api.back();
    if(a.type==='OPENING'&&m.opening?.enabled)return transition({...base(),kind:'opening'});
    if(a.type==='ENTER_PROJECT'||a.type==='FACADE')return transition(base());
    if(a.type==='OPEN_VIEW'){const v=views.find(v=>v.id===a.id);if(!v)return reject();return transition({kind:v.id===facade?.id?'facade':'plan',viewId:v.id,spaceId:v.spaceId||null,sceneId:null});}
    if(a.type==='OPEN_SPACE'){const s=spaces.find(s=>s.id===a.id);if(!s)return reject();const v=views.find(v=>v.spaceId===s.id);return transition({kind:['nivel','edificio','conjunto'].includes(s.kind)&&v?'plan':'unit',viewId:v?.id||null,spaceId:s.id,sceneId:null});}
    if(a.type==='OPEN_SCENE'){
     const scene=m.scenes.find(s=>s.id===a.id);if(!scene||!R.sceneIdsForScope(state.spaceId,spaces,m.scenes).includes(a.id))return reject();
     return transition({...state,kind:'tour',sceneId:a.id});
    }return reject();
   },
   back(){if(!stack.length)return transition(base(),false);state=stack.pop();notify();return true;},
   serialize(){const q=new URLSearchParams();if(state.kind==='opening')return '';if(state.viewId)q.set('view',state.viewId);if(state.spaceId)q.set('space',state.spaceId);if(state.sceneId)q.set('scene',state.sceneId);return q.toString();},
   restore(query){
    const q=query instanceof URLSearchParams?query:new URLSearchParams(String(query).replace(/^\?/,'')),previous=state,history=stack.slice();stack.length=0;state=base();
    for(const [key,type]of [['view','OPEN_VIEW'],['space','OPEN_SPACE'],['scene','OPEN_SCENE']]){
     let id=q.get(key);if(key==='scene'&&/^\d+$/.test(id||''))id=m.scenes[Number(id)]?.id||id;
     if(id&&!api.dispatch({type,id})){state=previous;stack.splice(0,stack.length,...history);return reject();}
    }notify();return true;
   }
  };return api;
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelShowroomNavigation=api;
})(typeof window!=='undefined'?window:globalThis);
