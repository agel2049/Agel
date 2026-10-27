/* One IFC job per worker. Original bytes and BIM metadata never leave this device. */
'use strict';
importScripts('./vendor/web-ifc/web-ifc-api-iife.js','./ifc-glb.js'+new URL(self.location.href).search,'./ifc-curves.js'+new URL(self.location.href).search,'./classify.js');
self.onmessage=async({data})=>{
 if(data?.type!=='convert')return;
 const api=new WebIFC.IfcAPI();let model;
 const progress=(stage,done=0,total=0)=>self.postMessage({type:'progress',stage,done,total});
 try{
  progress('Leyendo estructura IFC');api.SetWasmPath(new URL('./vendor/web-ifc/',self.location.href).href,true);await api.Init(undefined,true);api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_ERROR);
  const settings={COORDINATE_TO_ORIGIN:true,CIRCLE_SEGMENTS:16,ALLOW_INCOMPATIBLE_SCHEMA_ALIASES:false};
  model=api.OpenModel(new Uint8Array(data.bytes),settings);
  if(model<0||!api.IsModelOpen(model))throw Error('No se pudo abrir el IFC. Reexporta el archivo desde Revit.');
  const schema=api.GetModelSchema(model);if(!/^(IFC2X3|IFC4|IFC4X3(?:_ADD[12])?)$/i.test(schema))throw Error('El esquema '+schema+' no es compatible con esta importación local.');
  progress('Comprobando curvas de varillas');
  const curves=AgelIFCCurves.prepare(api,WebIFC,model,new Uint8Array(data.bytes));
  if(curves.adapted){api.CloseModel(model);model=api.OpenModel(curves.bytes,settings);if(model<0||!api.IsModelOpen(model))throw Error('No se pudo preparar la copia IFC. El original se conserva.');}
  const get=id=>api.GetLine(model,id,false),val=v=>v&&typeof v==='object'&&'value'in v?val(v.value):v,id=v=>v?.value;
  const text=v=>{v=val(v);return ['string','number','boolean'].includes(typeof v)?String(v).slice(0,240):'';};
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function each(type,fn){const code=WebIFC[type];if(code===undefined)return;const ids=api.GetLineIDsWithType(model,code);try{for(let i=0;i<ids.size();i++)fn(get(ids.get(i)));}finally{ids.delete?.();}}
  const parents=new Map(),containers=new Map(),storeys=new Map(),props=new Map(),psets=new Map(),materials=new Map(),systems=new Map(),types=new Map();
  const mep=new Set(),distribution=api.GetLineIDsWithType(model,WebIFC.IFCDISTRIBUTIONELEMENT,true);try{for(let i=0;i<distribution.size();i++)mep.add(distribution.get(i));}finally{distribution.delete?.();}
  each('IFCBUILDINGSTOREY',r=>storeys.set(r.expressID,text(r.Name)||'Nivel #'+r.expressID));
  each('IFCRELAGGREGATES',r=>{for(const item of r.RelatedObjects||[])parents.set(id(item),id(r.RelatingObject));});
  each('IFCRELCONTAINEDINSPATIALSTRUCTURE',r=>{for(const item of r.RelatedElements||[])containers.set(id(item),id(r.RelatingStructure));});
  const accepted=new Set(['discipline','disciplina','category','categoria','revit category','level','nivel','system name','nombre de sistema','system type','tipo de sistema','phase','fase','phase created','fase de creacion','loadbearing']);
  function pset(ref){const key=id(ref);if(psets.has(key))return psets.get(key);const set=get(key),out={};for(const p of set?.HasProperties||[]){const row=get(id(p)),name=text(row.Name);if(accepted.has(norm(name)))out[norm(name)]=val(row.NominalValue);}psets.set(key,out);return out;}
  function assign(items,sets){const data=Object.assign({},...sets.map(pset));for(const item of items||[])props.set(id(item),{...props.get(id(item)),...data});}
  each('IFCRELDEFINESBYTYPE',r=>{const type=get(id(r.RelatingType));for(const item of r.RelatedObjects||[])types.set(id(item),type.expressID);assign(r.RelatedObjects,type.HasPropertySets||[]);});
  each('IFCRELDEFINESBYPROPERTIES',r=>assign(r.RelatedObjects,Array.isArray(r.RelatingPropertyDefinition)?r.RelatingPropertyDefinition:[r.RelatingPropertyDefinition]));
  function materialNames(ref,seen=new Set(),depth=0){const key=id(ref);if(!key||seen.has(key)||depth>6)return [];seen.add(key);const r=get(key),names=[];
   if(api.GetLineType(model,key)===WebIFC.IFCMATERIAL&&text(r.Name))names.push(text(r.Name));
   for(const k of ['Material','ForLayerSet','ForProfileSet'])if(r[k])names.push(...materialNames(r[k],seen,depth+1));
   for(const k of ['Materials','MaterialLayers','MaterialConstituents','MaterialProfiles'])for(const item of r[k]||[])names.push(...materialNames(item,seen,depth+1));return names;
  }
  each('IFCRELASSOCIATESMATERIAL',r=>{const names=[...new Set(materialNames(r.RelatingMaterial))].join(' / ').slice(0,200);for(const item of r.RelatedObjects||[])materials.set(id(item),names);});
  each('IFCRELASSIGNSTOGROUP',r=>{const group=get(id(r.RelatingGroup));if(!/SYSTEM/i.test(api.GetNameFromTypeCode(group.type)))return;for(const item of r.RelatedObjects||[])systems.set(id(item),text(group.Name));});
  function levelFor(element){let key=containers.get(element);const seen=new Set();while(key&&!seen.has(key)){seen.add(key);if(storeys.has(key))return storeys.get(key);key=parents.get(key)||containers.get(key);}return '';}
  const b=AgelIFCGLB.create(),geometryCache=new Map(),issueIds=new Set(),issues=[];let ignored=0,last=0,skippedParts=0,skippedElements=0,emptyGeometries=0;
  function note(mesh,row,type){if(issueIds.has(mesh.expressID))return;issueIds.add(mesh.expressID);if(issues.length<20)issues.push({expressID:mesh.expressID,name:text(row.Name)||type,type,reason:'Sin superficie triangulable'});}
  progress('Preparando geometría');
  api.StreamAllMeshes(model,(mesh,index,total)=>{
   const row=get(mesh.expressID),type=api.GetNameFromTypeCode(row.type),upper=type.toUpperCase();if(['IFCSPACE','IFCOPENINGELEMENT'].includes(upper)){ignored++;return;}
   const p=props.get(mesh.expressID)||{},pick=(...keys)=>text(keys.map(k=>p[k]).find(v=>v!==undefined&&v!==null&&v!==''));
   let discipline=pick('discipline','disciplina')||(/^(IFCBEAM|IFCCOLUMN|IFCMEMBER|IFCFOOTING|IFCPILE|IFCREINFORCING)/.test(upper)||p.loadbearing===true||p.loadbearing==='T'?'Estructura':/^IFC(ELECTRIC|CABLE|LIGHT|PROTECTIVE|OUTLET|SWITCHING|JUNCTION)/.test(upper)?'Eléctrica':'');
   const category=pick('category','categoria','revit category')||(upper==='IFCCOVERING'?type+' · Acabados':type),parts=[],system=systems.get(mesh.expressID)||pick('system name','nombre de sistema','system type','tipo de sistema');
   if(!discipline&&mep.has(mesh.expressID)&&!AgelClassify.disciplineFor(category,system))discipline='Instalaciones (MEP)';
   for(let j=0;j<mesh.geometries.size();j++){
    const placed=mesh.geometries.get(j),key=placed.geometryExpressID;
    if(!geometryCache.has(key)){const g=api.GetGeometry(model,key);try{const geometry=b.geometry(key,api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()),api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize()),{reuseTranslation:/^IFCREINFORCING/.test(upper)});geometryCache.set(key,geometry);if(!geometry)emptyGeometries++;}catch(error){throw Error(`Elemento IFC #${mesh.expressID} (${type}), geometría #${key}: ${error.message}`);}finally{g.delete();}}
    const geometry=geometryCache.get(key);if(!geometry){skippedParts++;note(mesh,row,type);continue;}
    const c=placed.color,material=b.material([c.x,c.y,c.z,c.w],materials.get(mesh.expressID)||materials.get(types.get(mesh.expressID))||'');parts.push({geometry,material,matrix:Array.from(placed.flatTransformation)});
   }
   if(!parts.length){skippedElements++;note(mesh,row,type);}else b.element({id:mesh.expressID,name:text(row.Name)||type+' #'+mesh.expressID,metadata:{IFCClass:type,GlobalId:text(row.GlobalId),category,discipline,level:levelFor(mesh.expressID)||pick('level','nivel'),'System Name':system,phase:pick('phase created','fase de creacion','phase','fase')},parts});
   if(Date.now()-last>150||index===total-1){progress('Preparando geometría',index+1,total);last=Date.now();}
  },true);
  progress('Creando copia de visualización');
  const bytes=b.finish({schema,source:'IFC local',coordinateToOrigin:api.GetCoordinationMatrix(model),units:'metres'}),summary={schema,...b.stats,ignored,bytes:bytes.byteLength,skippedParts,skippedElements,emptyGeometries,issuesTotal:issueIds.size,issues,adaptedIndexedSweeps:curves.adapted,unsupportedIndexedSweeps:curves.unsupported};
  self.postMessage({type:'done',bytes,summary},[bytes]);
 }catch(error){self.postMessage({type:'error',message:error.message||'No se pudo preparar el IFC. Reexporta el modelo o divídelo por disciplinas.'});}
 finally{if(model!==undefined&&model>=0)try{api.CloseModel(model);}catch{}try{api.Dispose();}catch{}}
};
