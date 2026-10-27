const {test}=require('node:test'),assert=require('node:assert/strict');
let B;try{B=require('../packages/bim/ifc-glb.js');}catch{}
const vertices=new Float32Array([0,0,0,0,0,1, 2,0,0,0,0,1, 0,3,0,0,0,1]),indices=new Uint32Array([0,1,2]);
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
});
