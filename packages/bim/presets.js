(function(root){
 'use strict';
 const defaults={complete:{all:true},mep:{disciplines:['Mecánica (HVAC)','Eléctrica','Hidrosanitaria','Protección contra incendio']},masonry:{categories:['Walls','Muros','IfcWall','IfcWallStandardCase','Masonry']},structure:{disciplines:['Estructura']},finishes:{},grey:{}};
 function selectIds(elements,preset={}){
  if(preset.all)return elements.map(e=>e.dbid).filter(Number.isInteger);
  const fields=[['disciplines','discipline'],['levels','level'],['categories','category']];
  if(!fields.some(([k])=>preset[k]?.length)&&!preset.ids?.length)return null;
  return elements.filter(e=>(!preset.ids?.length||preset.ids.includes(e.dbid))&&fields.every(([k,f])=>!preset[k]?.length||preset[k].includes(e[f]))).map(e=>e.dbid).filter(Number.isInteger);
 }
 function safeReturn(value,base){try{if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return null;const here=new URL(base),url=new URL(value,here),site=new URL('../../',here);if(url.origin!==here.origin||!url.pathname.startsWith(site.pathname))return null;return url.pathname+url.search+url.hash;}catch{return null;}}
 const api={selectIds,safeReturn,defaults};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelBimPresets=api;
})(typeof window!=='undefined'?window:globalThis);
