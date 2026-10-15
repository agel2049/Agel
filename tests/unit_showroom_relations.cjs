const test=require('node:test'),assert=require('node:assert/strict');
let R;try{R=require('../packages/showroom/relations.js');}catch{R={};}
const scenes=[{id:'sa'},{id:'sb'},{id:'shared'}];
const spaces=[{id:'n',parent_id:null,sceneIds:[]},{id:'a',parent_id:'n',sceneIds:['sa','shared']},{id:'b',parent_id:'n',sceneIds:['sb','shared']}];
test('a department scope excludes its sibling and deduplicates shared scenes',()=>{
 assert.equal(typeof R.sceneIdsForScope,'function');
 assert.deepEqual(R.sceneIdsForScope('a',spaces,scenes),['sa','shared']);
 assert.deepEqual(R.sceneIdsForScope('n',spaces,scenes),['sa','shared','sb']);
 assert.deepEqual(R.sceneIdsForScope('missing',spaces,scenes),[]);
 assert.deepEqual(R.sceneIdsForScope(null,spaces,scenes),['sa','sb','shared']);
});
test('cycles and duplicate space identifiers are rejected',()=>{
 assert.throws(()=>R.sceneIdsForScope('a',[{id:'a',parent_id:'b'},{id:'b',parent_id:'a'}],scenes),/cíclica/);
 assert.throws(()=>R.normalizeSpaces([{id:'a'},{id:'a'}],scenes),/duplicado/);
});
test('legacy indices and authoring UUID references normalize to stable ids',()=>{
 assert.deepEqual(R.normalizeSpaces([{id:'a',scenes:[0,2,99]}],scenes)[0].sceneIds,['sa','shared']);
 assert.deepEqual(R.normalizeSpaces([{id:'a',scene_ids:['sb','foreign']}],scenes)[0].sceneIds,['sb']);
});
const view=i=>({id:`view${i}`,image:`https://images.example/v${i}.png`,title:`Vista ${i}`,kind:'plano',spaceId:'a',regions:[],spots:[]});
test('nine image-only views survive publication normalization',()=>{
 const result=R.normalizeExperience({views:Array.from({length:9},(_,i)=>view(i))},spaces,scenes,{publicMode:true});
 assert.equal(result.views.length,9);assert.equal(result.views[8].image,'https://images.example/v8.png');
});
test('limits never silently truncate views',()=>{
 assert.throws(()=>R.normalizeExperience({views:Array.from({length:257},(_,i)=>view(i))},spaces,scenes),/256/);
});
test('local media is authorable but never public and unsafe URLs are rejected',()=>{
 const local={...view(0),image:'agel-local:abc'};
 assert.equal(R.normalizeExperience({views:[local]},spaces,scenes,{publicMode:false}).views[0].image,'agel-local:abc');
 assert.throws(()=>R.normalizeExperience({views:[local]},spaces,scenes,{publicMode:true}),/sincroniz/);
 assert.throws(()=>R.normalizeExperience({views:[{...view(0),image:'javascript:alert(1)'}]},spaces,scenes),/dirección/);
});
test('unknown scope and destinations do not fall back to project-wide access',()=>{
 assert.throws(()=>R.normalizeExperience({views:[{...view(0),spaceId:'other'}]},spaces,scenes),/espacio/);
 assert.throws(()=>R.normalizeExperience({views:[{...view(0),spots:[{scene:'sb',x:30,y:40}]}]},spaces,scenes),/alcance/);
});
test('opening has a poster and one button, never an ending',()=>{
 const x=R.normalizeExperience({opening:{enabled:true,video:'https://images.example/open.mp4',poster:'https://images.example/p.png',btn:'Ir',ending:'bad'},views:[view(0)]},spaces,scenes);
 assert.equal(x.opening.button,'Ir');assert.equal(x.opening.poster,'https://images.example/p.png');assert.equal('ending' in x.opening,false);
});
test('entry must reference a different existing view',()=>{
 assert.throws(()=>R.normalizeExperience({experience:{version:1,facadeViewId:'view0',entryTargetViewId:'view0'},views:[view(0)]},spaces,scenes),/entrada/);
});
test('a unit with cyclic ancestors cannot silently return its scenes',()=>assert.throws(()=>R.sceneIdsForScope('unit',[{id:'tower',parent_id:'floor'},{id:'floor',parent_id:'tower'},{id:'unit',parent_id:'floor',scene_ids:['sa']}],scenes),/cíclica/));
