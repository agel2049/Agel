const test=require('node:test'),assert=require('node:assert/strict');
let G;try{G=require('../packages/showroom/geometry.js');}catch{G={};}
test('orthogonal constraint can be toggled without changing the figure',()=>{
 assert.equal(typeof G.snapPoint,'function');const points=[[10,10],[40,10]];
 assert.deepEqual(G.snapPoint(points.at(-1),[42,35],true),[40,35]);
 assert.deepEqual(G.snapPoint(points.at(-1),[62,12],true),[62,10]);
 assert.deepEqual(G.snapPoint(points.at(-1),[42,35],false),[42,35]);
 assert.deepEqual(points,[[10,10],[40,10]]);
});
test('rounding respects rectangular image metrics and original points',()=>{
 const p=[[10,10],[90,10],[90,90],[10,90]],before=JSON.stringify(p);
 const d=G.roundedPath(p,{w:1600,h:900,radius:2});
 assert.ok(d.includes('M 160 108'));assert.ok(d.includes('Q 160 90 178 90'));
 assert.equal(JSON.stringify(p),before);
 assert.ok(!G.roundedPath(p,{w:1600,h:900,radius:0}).includes('Q'));
});
test('concave polygons and tiny sides produce finite simple curves',()=>{
 for(const p of [[[0,0],[80,0],[80,80],[40,40],[0,80]],[[1,1],[1.01,1],[80,80],[1,80]]]){
  const d=G.roundedPath(p,{w:1600,h:900,radius:2});assert.ok(!/NaN|Infinity/.test(d));assert.ok(d.endsWith('Z'));
 }
});
test('crossed, degenerate, duplicate and nonfinite polygons are rejected',()=>{
 for(const p of [[[0,0],[90,90],[0,90],[90,0]],[[0,0],[10,10],[20,20]],[[0,0],[10,0],[10,0],[0,10]],[[0,0],[NaN,0],[0,10]]])
  assert.equal(G.validatePolygon(p,{w:100,h:100}).valid,false);
 assert.throws(()=>G.roundedPath([[0,0],[10,10],[20,20]],{w:100,h:100,radius:1}),/zona|área/);
});
test('mouse coordinates exclude image letterboxing',()=>{
 assert.deepEqual(G.imagePoint({clientX:200,clientY:100},{left:100,top:50,width:200,height:100}),[50,50]);
 assert.equal(G.imagePoint({clientX:50,clientY:100},{left:100,top:50,width:200,height:100}),null);
});
