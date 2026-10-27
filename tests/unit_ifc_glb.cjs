const {test}=require('node:test'),assert=require('node:assert/strict');
let B;try{B=require('../packages/bim/ifc-glb.js');}catch{}
const vertices=new Float32Array([0,0,0,0,0,1, 2,0,0,0,0,1, 0,3,0,0,0,1]),indices=new Uint32Array([0,1,2]);
test('translated rebar geometry is stored once without merging identity or placement',()=>{
 const b=B.create(),shifted=vertices.map((v,i)=>i%6===0?v+10:i%6===1?v+20:v),a=b.geometry('a',vertices,indices,{reuseTranslation:true}),g=b.geometry('b',shifted,indices,{reuseTranslation:true}),mat=b.material([1,1,1,1]);
 assert.equal(a.position,g.position,'Identical translated shapes should share a buffer');
 const rotation=[0,1,0,0,-1,0,0,0,0,0,1,0,100,0,0,1];
 for(const [id,geometry]of [[1,a],[2,g]])b.element({id,name:'Varilla',parts:[{geometry,material:mat,matrix:rotation}]});
 const bytes=b.finish(),v=new DataView(bytes),j=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,v.getUint32(12,true))));
 assert.equal(j.meshes.length,1);assert.equal(j.scenes[0].nodes.length,2);assert.deepEqual(j.nodes[3].matrix.slice(12,15),[80,10,0]);
 const changed=shifted.slice();changed[6]+=.01;assert.notEqual(b.geometry('different',changed,indices,{reuseTranslation:true}).position,a.position);
});
test('IFC GLB builder preserves shared geometry, identity, transform and typed properties',()=>{
 assert.ok(B,'IFC GLB builder missing');const b=B.create(),g=b.geometry('g',vertices,indices),mat=b.material([.8,.7,.6,1],'Ladrillo');
 const transform=[1,0,0,0,0,1,0,0,0,0,1,0,5,0,0,1];
 b.element({id:42,name:'Muro',metadata:{GlobalId:'ifc-guid',category:'IfcWall',level:'Nivel 1'},parts:[{geometry:g,material:mat,matrix:transform}]});
 b.element({id:43,name:'Otro muro',metadata:{category:'IfcWall'},parts:[{geometry:g,material:mat,matrix:transform}]});
 const bytes=b.finish({schema:'IFC4'}),v=new DataView(bytes),length=v.getUint32(12,true),j=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
 assert.equal(v.getUint32(0,true),0x46546c67);assert.equal(v.getUint32(8,true),bytes.byteLength);assert.equal(bytes.byteLength%4,0);
 assert.equal(j.meshes.length,1);assert.equal(j.materials.length,1);assert.equal(j.accessors[0].count,3);assert.deepEqual(j.accessors[0].max,[2,3,0]);
 assert.equal(j.nodes[0].extras.GlobalId,'ifc-guid');assert.equal(j.nodes[0].extras.expressID,42);assert.equal(j.nodes[1].matrix[12],5);assert.equal(j.asset.extras.schema,'IFC4');
});
test('invalid IFC geometry is rejected before a corrupt GLB is produced',()=>{
 assert.ok(B,'IFC GLB builder missing');const b=B.create();assert.throws(()=>b.geometry('bad',new Float32Array([NaN,0,0,0,0,1]),indices),/geometr|v[eé]rtice/i);assert.throws(()=>b.finish(),/geometr|pieza/i);
 assert.throws(()=>b.geometry('broken-triangle',vertices,new Uint32Array([0,1])),/incompleta/);
 assert.throws(()=>b.geometry('broken-vertex',new Float32Array(5),indices),/incompleta/);
});
test('empty IFC surfaces do not reject valid geometry in the same model',()=>{
 const b=B.create();assert.equal(b.geometry('empty',new Float32Array(12),new Uint32Array()),null);
 assert.equal(b.geometry('missing',new Float32Array(),new Uint32Array()),null);
 const g=b.geometry('valid',vertices,indices),mat=b.material([1,1,1,1]);b.element({id:1,name:'Muro',parts:[{geometry:g,material:mat,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]});
 assert.ok(b.finish().byteLength>100);
});
