const test=require('node:test'),assert=require('node:assert/strict'),P=require('../packages/bim/presets.js');
test('Varillas selects exported rebar categories without including all structural steel',()=>{
 const rows=[{dbid:1,category:'Structural Rebar',level:'1'},{dbid:2,category:'Armadura estructural',level:'2'},{dbid:3,category:'IfcReinforcingBar',level:'2'},{dbid:4,category:'Structural Framing',level:'2'}];
 assert.deepEqual(P.selectIds(rows,P.defaults.rebar),[1,2,3]);
 assert.deepEqual(P.selectIds(rows,{...P.defaults.rebar,levels:['2']}),[2,3]);
 assert.deepEqual(P.selectIds([],P.defaults.rebar),[]);
});
test('MEP selects the union of disciplines',()=>assert.deepEqual(P.selectIds([{dbid:1,discipline:'Eléctrica'},{dbid:2,discipline:'Hidrosanitaria'},{dbid:3,discipline:'Estructura'}],{disciplines:['Eléctrica','Hidrosanitaria']}),[1,2]));
test('masonry and structure presets use exported categories and disciplines',()=>{
 const rows=[{dbid:1,category:'Walls',discipline:'Arquitectura'},{dbid:2,category:'Structural Framing',discipline:'Estructura'},{dbid:3,category:'Pipes',discipline:'Hidrosanitaria'}];
 assert.deepEqual(P.selectIds(rows,P.defaults.masonry),[1]);assert.deepEqual(P.selectIds(rows,P.defaults.structure),[2]);
});
test('categories and levels restrict the union; empty preset does not pretend success',()=>{assert.deepEqual(P.selectIds([{dbid:1,discipline:'Eléctrica',level:'1'},{dbid:2,discipline:'Eléctrica',level:'2'}],{disciplines:['Eléctrica'],levels:['1']}),[1]);assert.equal(P.selectIds([],{}),null);});
test('return route must stay inside this installation',()=>{assert.equal(P.safeReturn('https://evil.test/','https://a.test/Agel/apps/bim/'),null);assert.equal(P.safeReturn('/Agel/apps/showroom/?p=x','https://a.test/Agel/apps/bim/'),'/Agel/apps/showroom/?p=x');assert.equal(P.safeReturn('//evil.test','https://a.test/Agel/apps/bim/'),null);assert.equal(P.safeReturn('/outside','https://a.test/Agel/apps/bim/'),null);});
