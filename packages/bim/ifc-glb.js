/* Small self-contained glTF writer for IFC meshes. No renderer, network or source files. */
(function(root){
 'use strict';
 function create(){
  const doc={asset:{version:'2.0',generator:'Archgel IFC local 1'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}]};
  const chunks=[],geometries=new Map(),materials=new Map(),meshes=new Map();let offset=0,triangles=0;
  function view(data,target,stride){const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice(),index=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.byteLength,target,...(stride?{byteStride:stride}:{})});chunks.push({offset,bytes});offset+=Math.ceil(bytes.byteLength/4)*4;return index;}
  function accessor(v,componentType,count,type,more={}){const index=doc.accessors.length;doc.accessors.push({bufferView:v,componentType,count,type,...more});return index;}
  function geometry(key,vertices,indices){
   if(geometries.has(key))return geometries.get(key);
   if(!vertices?.length||!indices?.length)return null;
   if(vertices.length%6||indices.length%3)throw Error('Geometría IFC incompleta.');
   const count=vertices.length/6,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
   for(let i=0;i<vertices.length;i++){if(!Number.isFinite(vertices[i]))throw Error('Vértice IFC no válido.');if(i%6<3){const axis=i%6;min[axis]=Math.min(min[axis],vertices[i]);max[axis]=Math.max(max[axis],vertices[i]);}}
   for(const i of indices)if(!Number.isInteger(i)||i<0||i>=count)throw Error('Índice de geometría IFC fuera del modelo.');
   const vv=view(vertices,34962,24),iv=view(indices,34963),g={position:accessor(vv,5126,count,'VEC3',{byteOffset:0,min,max}),normal:accessor(vv,5126,count,'VEC3',{byteOffset:12}),indices:accessor(iv,5125,indices.length,'SCALAR'),triangles:indices.length/3};geometries.set(key,g);return g;
  }
  function material(color,name=''){
   const rgba=color.map((n,i)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:i===3?1:.8))),key=JSON.stringify([rgba,name]);if(materials.has(key))return materials.get(key);
   const id=doc.materials.length;doc.materials.push({...(name?{name}:{}),pbrMetallicRoughness:{baseColorFactor:rgba,metallicFactor:0,roughnessFactor:.85},doubleSided:true,...(rgba[3]<.999?{alphaMode:'BLEND'}:{})});materials.set(key,id);return id;
  }
  function element({id,name,metadata={},parts}){
   if(!parts.length)return;const node=doc.nodes.length,children=[];doc.nodes.push({name:'IFC #'+id,extras:{...metadata,expressID:id},children});doc.scenes[0].nodes.push(node);
   for(const p of parts){if(p.matrix.length!==16||!p.matrix.every(Number.isFinite))throw Error('Transformación de pieza IFC no válida.');const g=p.geometry,key=g.position+':'+p.material;let mesh=meshes.get(key);
    if(mesh===undefined){mesh=doc.meshes.length;doc.meshes.push({primitives:[{attributes:{POSITION:g.position,NORMAL:g.normal},indices:g.indices,material:p.material}]});meshes.set(key,mesh);}
    children.push(doc.nodes.length);doc.nodes.push({name,mesh,matrix:p.matrix});triangles+=g.triangles;
   }
  }
  function finish(extras={}){
   if(!doc.scenes[0].nodes.length)throw Error('El IFC no contiene piezas de geometría visibles.');
   doc.asset.extras=extras;doc.buffers[0].byteLength=offset;const json=new TextEncoder().encode(JSON.stringify(doc)),jl=Math.ceil(json.length/4)*4,total=12+8+jl+8+offset;
   if(total>0xffffffff)throw Error('La copia preparada excede el tamaño que admite GLB. Divide el IFC por disciplinas o edificios.');
   const bytes=new ArrayBuffer(total),v=new DataView(bytes),u=new Uint8Array(bytes);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,jl,true);v.setUint32(16,0x4e4f534a,true);u.fill(32,20,20+jl);u.set(json,20);v.setUint32(20+jl,offset,true);v.setUint32(24+jl,0x004e4942,true);for(const c of chunks)u.set(c.bytes,28+jl+c.offset);return bytes;
  }
  return {geometry,material,element,finish,get stats(){return {elements:doc.scenes[0].nodes.length,geometries:geometries.size,triangles};}};
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelIFCGLB=api;
})(typeof window!=='undefined'?window:globalThis);
