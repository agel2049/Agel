const test=require('node:test'),assert=require('node:assert/strict'),C=require('../packages/bim/ifc-curves.js');
test('only a proven full indexed sweep can remove redundant trimming',()=>{
 const points=[[0,0,0],[1,0,0],[2,0,0]];
 assert.equal(C.fullInterval({points,start:0,end:2}),true);
 for(const [start,end]of [[.5,2],[0,1],[0,3],[0,NaN]])assert.equal(C.fullInterval({points,start,end}),false);
 const arc=[[1,0,0],[Math.SQRT1_2,Math.SQRT1_2,0],[0,1,0]];
 assert.equal(C.fullInterval({points:arc,segments:[{kind:'arc',indices:[1,2,3]}],start:0,end:90,radiansPerUnit:Math.PI/180}),true);
 assert.equal(C.fullInterval({points:arc,segments:[{kind:'arc',indices:[1,2,3]}],start:0,end:45,radiansPerUnit:Math.PI/180}),false);
 assert.equal(C.fullInterval({points,segments:[{kind:'arc',indices:[1,2,3]}],start:0,end:2}),false);
});
test('byte splice preserves the source and unrelated sweeps including non-ASCII text',()=>{
 const prefix=Uint8Array.from([0x80,0xff]),text=new TextEncoder().encode("#1=IFCSWEPTDISKSOLID(#10,.01,$,0.,1.);\n#2=IFCSWEPTDISKSOLID(#20,.02,$,.2,.8);"),bytes=new Uint8Array([...prefix,...text]),before=bytes.slice();
 const result=C.rewrite(bytes,new Set([1]));assert.deepEqual(bytes,before);assert.deepEqual(result.slice(0,2),prefix);
 assert.equal(new TextDecoder().decode(result.slice(2)),"#1=IFCSWEPTDISKSOLID(#10,.01,$,$,$);\n#2=IFCSWEPTDISKSOLID(#20,.02,$,.2,.8);");
 assert.throws(()=>C.rewrite(bytes,new Set([3])),/adaptar/);
});
