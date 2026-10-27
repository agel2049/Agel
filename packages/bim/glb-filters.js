/* Metadata and visibility decisions for exported GLB parts. No renderer/network. */
(function(root){
 'use strict';
 const C=typeof module!=='undefined'&&module.exports?require('./classify.js'):root.AgelClassify;
 const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const fields=['discipline','category','level','group','material'];
 function properties(data,out=[],depth=0){
  if(!data||typeof data!=='object'||depth>3)return out;
  if(Array.isArray(data)){for(const p of data.slice(0,300)){if(p&&typeof p==='object'&&(p.displayName||p.name))out.push({displayName:p.displayName||p.name,displayValue:p.displayValue??p.value});}return out;}
  for(const[k,v]of Object.entries(data).slice(0,300)){
   if(v!=null&&['string','number','boolean'].includes(typeof v))out.push({displayName:k,displayValue:String(v).slice(0,300)});
   else if(v&&typeof v==='object')properties(v,out,depth+1);
  }return out;
 }
 const prop=(props,names)=>props.find(p=>names.includes(norm(p.displayName))&&p.displayValue!=null)?.displayValue||'';
 function describe(mesh,ancestors=[]){
  const props=[...properties(mesh.userData),...ancestors.slice().reverse().flatMap(n=>properties(n.userData))];
  const named=[mesh.name,...ancestors.slice().reverse().map(n=>n.name)].filter(Boolean).join(' / '),name=String(mesh.name||'Elemento').slice(0,200);
  let category=String(prop(props,C.PROPS.category)).slice(0,120),source=category?'properties':'unknown';
  if(!category){
   const n=norm(named),known=[[/\b(muros?|walls?|tabique|albanileria|masonry)\b/,'Muros'],[/\b(tuberias?|pipes?|plumbing)\b/,'Pipes'],[/\b(electrica|electrical|luminarias?|cable trays?|conduit)\b/,'Electrical'],[/\b(ductos?|ducts?|hvac)\b/,'Ducts'],[/\b(estructura|structural|cimentacion)\b/,'Structural'],[/\b(acabados?|finishes|recubrimientos?)\b/,'Acabados']];
   category=known.find(([re])=>re.test(n))?.[1]||'';if(category)source='name';
  }
  const explicit=String(prop(props,['discipline','disciplina'])).slice(0,120),system=prop(props,C.PROPS.system);
  const discipline=explicit||C.disciplineFor(category,system)||'Sin clasificar';if(explicit)source='properties';
  const mats=[...new Set((Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m?.name).filter(Boolean))];
  const material=mats.join(' / ').slice(0,200)||'Sin material nombrado',text=norm(category+' '+named);
  // IFC class survives on the parent node even when Revit exports a broad category.
  const ifcClass=norm(prop(props,['ifcclass','ifc class','ifc type']));
  const isRebar=C.isRebar(category,ifcClass,named);
  let bucket='unknown';
  if(/electri|hidrosan|mecanica|hvac|incendio|plumb|mechanical|mep/.test(norm(discipline)))bucket='mep';
  else if(/acabado|finish|recubrimiento/.test(text))bucket='finishes';
  else if(isRebar||/estructur|structur/.test(norm(discipline)))bucket='structure';
  else if(/muros?|wall|tabique|albanileria|masonry/.test(text))bucket='masonry';
  return {id:mesh.uuid,name,discipline,category:category||'Sin categoría',level:String(prop(props,C.PROPS.level)).slice(0,120)||'Sin nivel',group:ancestors.map(n=>n.name).filter(Boolean).join(' / ').slice(0,200)||'Sin grupo',material,bucket,source,isRebar};
 }
 function select(elements,{facets:filters={},query='',preset='all'}={}){
  if(!['all','mep','masonry','structure','rebar','finishes','grey'].includes(preset))throw Error('Filtro de modelo desconocido');
  const q=norm(query);
  return elements.filter(e=>(preset==='all'||(preset==='rebar'?e.isRebar:preset==='grey'?['masonry','structure'].includes(e.bucket):e.bucket===preset))&&
   fields.every(f=>!filters[f]?.length||filters[f].includes(e[f]))&&(!q||norm([e.name,...fields.map(f=>e[f])].join(' ')).includes(q)));
 }
 function facets(elements){return Object.fromEntries(fields.map(f=>{const counts=new Map();for(const e of elements)if(e[f])counts.set(e[f],(counts.get(e[f])||0)+1);return [f,Object.fromEntries(counts)];}));}
 const api={describe,select,facets,fields};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelGLBFilters=api;
})(typeof window!=='undefined'?window:globalThis);
