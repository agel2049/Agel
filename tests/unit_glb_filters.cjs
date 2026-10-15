const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../packages/bim/glb-filters.js');
const mesh=(id,name,userData={},material='Material')=>({uuid:id,name,userData,material:{name:material}});
test('explicit BIM properties and inherited level describe actual exported parts',()=>{
 const e=F.describe(mesh('pipe','Tubería 01',{Category:'Pipes'},'Cobre'),[{name:'Nivel 2',userData:{Level:'Nivel 2'}}]);
 assert.equal(e.discipline,'Hidrosanitaria');assert.equal(e.level,'Nivel 2');assert.equal(e.material,'Cobre');assert.equal(e.bucket,'mep');assert.equal(e.source,'properties');
});
test('unclassified geometry stays available without fabricated disciplines',()=>{
 const e=F.describe(mesh('unknown','Objeto 01'),[]);assert.equal(e.discipline,'Sin clasificar');assert.equal(e.bucket,'unknown');assert.equal(e.source,'unknown');
 assert.deepEqual(F.select([e],{preset:'mep'}),[]);assert.equal(F.select([e],{}).length,1);
});
test('names are distinguished from explicit properties and masonry from finishes',()=>{
 const wall=F.describe(mesh('wall','Muros de tabique'),[]),finish=F.describe(mesh('finish','Acabados de fachada'),[]);
 assert.equal(wall.bucket,'masonry');assert.equal(wall.source,'name');assert.equal(finish.bucket,'finishes');
});
test('OR within a facet and AND between facets; zero matches remains empty',()=>{
 const rows=[{id:'a',discipline:'Eléctrica',level:'1',name:'Luz'},{id:'b',discipline:'Hidrosanitaria',level:'2',name:'Agua'},{id:'c',discipline:'Eléctrica',level:'2',name:'Luz 2'}];
 assert.deepEqual(F.select(rows,{facets:{discipline:['Eléctrica','Hidrosanitaria'],level:['2']}}).map(x=>x.id),['b','c']);
 assert.deepEqual(F.select(rows,{facets:{level:['ausente']}}),[]);
 assert.deepEqual(F.select(rows,{query:'eléctrica'}).map(x=>x.id),['a','c']);
});
test('facets count exported fields including hostile text as ordinary values',()=>{
 const rows=[{discipline:'__proto__',level:'Nivel 1'},{discipline:'__proto__',level:'Nivel 2'}];
 assert.equal(F.facets(rows).discipline['__proto__'],2);assert.equal(F.facets(rows).level['Nivel 1'],1);
});
