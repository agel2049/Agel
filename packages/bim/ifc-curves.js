/* Compatibility for full indexed sweeps. Never discard a partial/unknown trim. */
(function(root){
 'use strict';
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 function arcAngle(a,b,c){
  const u=sub(b,a),v=sub(c,a),n=cross(u,v),nn=dot(n,n);if(nn<1e-24)return NaN;
  const p=cross(n,u),q=cross(v,n),center=a.map((x,i)=>x+(dot(v,v)*p[i]+dot(u,u)*q[i])/(2*nn)),s=sub(a,center),e=sub(c,center);
  let angle=Math.atan2(dot(cross(s,e),n)/Math.sqrt(nn),dot(s,e));if(angle<=0)angle+=2*Math.PI;return angle;
 }
 function fullInterval({points,segments,start,end,radiansPerUnit=1}){
  if(!Array.isArray(points)||points.length<2||!points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Number.isFinite(radiansPerUnit)||radiansPerUnit<=0)return false;
  let extent=0;
  if(!segments?.length)extent=points.length-1;
  else {let previous;
   for(const s of segments){const ids=s.indices;if(!Array.isArray(ids)||ids.length<2||!ids.every(i=>Number.isInteger(i)&&i>=1&&i<=points.length)||previous!==undefined&&previous!==ids[0])return false;
    if(s.kind==='line')extent+=ids.length-1;
    else if(s.kind==='arc'&&ids.length===3)extent+=arcAngle(...ids.map(i=>points[i-1]))/radiansPerUnit;
    else return false;previous=ids.at(-1);
   }
  }
  return Number.isFinite(extent)&&extent>0&&Number.isFinite(start)&&Number.isFinite(end)&&Math.abs(start)<1e-9&&Math.abs(end-extent)<=Math.max(1e-7,extent*1e-8);
 }
 // Latin-1 decoding provides one JS character per source byte. Splice original
 // byte slices so non-ASCII source text is preserved without re-encoding it.
 function rewrite(bytes,ids){
  if(!ids.size)return bytes;const source=new TextDecoder('latin1').decode(bytes),edits=[];
  const re=/#(\d+)\s*=\s*IFCSWEPTDISKSOLID\s*\(\s*#\d+\s*,\s*[^,()]+,\s*[^,()]+,\s*[^,()]+,\s*[^,()]+\s*\)\s*;/gi;
  for(const m of source.matchAll(re))if(ids.has(Number(m[1]))){const tail=m[0].lastIndexOf(')'),prefix=m[0].slice(0,tail).split(',').slice(0,3).join(',');edits.push({start:m.index,end:m.index+m[0].length,replacement:new TextEncoder().encode(prefix+',$,$'+m[0].slice(tail))});}
  if(edits.length!==ids.size)throw Error('No se pudo adaptar una curva IFC. El original se conserva.');
  const result=new Uint8Array(bytes.length+edits.reduce((n,e)=>n+e.replacement.length-(e.end-e.start),0));let at=0,previous=0;
  for(const e of edits){result.set(bytes.subarray(previous,e.start),at);at+=e.start-previous;result.set(e.replacement,at);at+=e.replacement.length;previous=e.end;}result.set(bytes.subarray(previous),at);return result;
 }
 function prepare(api,W,model,bytes){
  const value=v=>v&&typeof v==='object'&&'value'in v?value(v.value):v;
  const get=id=>api.GetLine(model,id,false),all=type=>{if(type===undefined)return [];const rows=api.GetLineIDsWithType(model,type);try{return Array.from({length:rows.size()},(_,i)=>rows.get(i));}finally{rows.delete?.();}};
  // Revit expresses arc parameters in the project's plane-angle unit.
  let radiansPerUnit=1;
  for(const pid of all(W.IFCPROJECT)){const project=get(pid),units=project.UnitsInContext&&get(project.UnitsInContext.value);for(const ref of units?.Units||[]){const u=get(ref.value);if(value(u.UnitType)!=='PLANEANGLEUNIT')continue;
    if(u.type===W.IFCSIUNIT&&value(u.Name)==='RADIAN'&&!u.Prefix)radiansPerUnit=1;
    else if(u.type===W.IFCCONVERSIONBASEDUNIT){const f=get(u.ConversionFactor.value),base=get(f.UnitComponent.value);radiansPerUnit=value(base.Name)==='RADIAN'&&!base.Prefix?Number(value(f.ValueComponent)):NaN;}
    else radiansPerUnit=NaN;
   }}
  const ids=new Set();let unsupported=0;
  for(const sid of all(W.IFCSWEPTDISKSOLID)){const solid=get(sid);if(solid.StartParam==null&&solid.EndParam==null)continue;const curve=get(solid.Directrix.value);if(curve.type!==W.IFCINDEXEDPOLYCURVE)continue;
   // GetLine loses the select's IFC name in 0.0.78; raw tokens retain its typecode.
   const points=get(curve.Points.value).CoordList.map(p=>p.map(v=>Number(value(v)))),rawSegments=api.GetRawLineData(model,curve.expressID).arguments[1],segments=rawSegments?.map(s=>({kind:s.typecode===W.IFCLINEINDEX?'line':s.typecode===W.IFCARCINDEX?'arc':'unknown',indices:s.value.map(v=>Number(value(v)))}));
   if(fullInterval({points,segments,start:solid.StartParam==null?0:Number(value(solid.StartParam)),end:solid.EndParam==null?NaN:Number(value(solid.EndParam)),radiansPerUnit}))ids.add(sid);else unsupported++;
  }
  return {bytes:rewrite(bytes,ids),adapted:ids.size,unsupported};
 }
 const api={fullInterval,rewrite,prepare};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelIFCCurves=api;
})(typeof self!=='undefined'?self:globalThis);
