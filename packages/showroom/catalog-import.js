(function(root){
 'use strict';
 const F=typeof module!=='undefined'&&module.exports?require('../bim/fourd.js'):root.AgelFourD;
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 function parse(csv){
  const rows=F.parseCSV(csv),groups=new Map(),levels=new Map(),units=[],problems=[],codes=new Set();
  if(rows.length<2)return {groups:[],levels:[],units,problems:['El archivo no tiene unidades']};
  const head=rows[0].map(norm),col=(...names)=>head.findIndex(n=>names.includes(n)),val=(row,...names)=>String(row[col(...names)]||'').trim();
  if(col('nombre','unidad','name')<0&&col('clave','codigo','code')<0)problems.push('Falta la columna nombre o clave');
  const numeric=(row,label,names,min,max,integer=false)=>{let text=val(row,...names);if(!text)return null;
   text=text.replace(/[$\s]/g,'');text=/^\d+,\d{1,2}$/.test(text)?text.replace(',','.'):text.replace(/,/g,'');
   const n=Number(text);if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isInteger(n)){problems.push(`Fila ${row._line}: ${label} inválida`);return null;}return n;};
  for(const [i,row] of rows.slice(1).entries()){
   if(row.every(x=>!String(x).trim()))continue;row._line=i+2;
   const name=val(row,'nombre','unidad','name')||val(row,'clave','codigo','code'),code=val(row,'clave','codigo','code');
   if(!name||name.length>120||code.length>40)problems.push(`Fila ${i+2}: nombre o clave inválidos`);
   if(code&&codes.has(norm(code)))problems.push(`Fila ${i+2}: clave duplicada «${code}»`);if(code)codes.add(norm(code));
   const group=val(row,'grupo','torre','edificio'),level=val(row,'nivel','planta','floor'),groupKey=group?norm(group):null;
   if(group.length>120||level.length>120)problems.push(`Fila ${i+2}: edificio o nivel demasiado largo`);
   if(group)groups.set(groupKey,{key:groupKey,name:group});
   if(level&&!group)problems.push(`Fila ${i+2}: el nivel necesita un edificio`);
   const levelKey=level&&group?`${groupKey}/${norm(level)}`:null;
   if(levelKey)levels.set(levelKey,{key:levelKey,groupKey,name:/^\d+$/.test(level)?`Nivel ${level}`:level});
   const st=norm(val(row,'estado','disponibilidad'));
   const data={name,code,kind:'unidad',currency:'MXN',
    area_m2:numeric(row,'superficie',['m2','area','superficie'],0,1e6),bedrooms:numeric(row,'recámaras',['recamaras','habitaciones'],0,50,true),
    bathrooms:numeric(row,'baños',['banos'],0,50),parking:numeric(row,'estacionamientos',['estacionamientos','cajones'],0,50,true),
    price:numeric(row,'precio',['precio','price'],0,1e12),show_price:/^(si|yes|1|true|x)$/.test(norm(val(row,'mostrar_precio','mostrar precio'))),
    availability:['disponible','apartada','vendida'].includes(st)?st:st?'no_aplica':'disponible'};
   units.push({groupKey,levelKey,data});
  }
  if(units.length>2000)problems.push('Máximo 2000 unidades por importación');
  return {groups:[...groups.values()],levels:[...levels.values()],units,problems};
 }
 const api={parse,norm};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelCatalogImport=api;
})(typeof window!=='undefined'?window:globalThis);
