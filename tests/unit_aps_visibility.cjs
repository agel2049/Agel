const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('empty APS filter hides geometry instead of clearing isolation and showing all',()=>{
 const calls=[],window={};vm.runInNewContext(fs.readFileSync('packages/bim/aps-adapter.js','utf8'),{window});
 const model={getInstanceTree:()=>({getRootId:()=>0,enumNodeChildren:(id,fn)=>[1,2,3].forEach(fn),getChildCount:()=>0})};
 const renderer={hide:ids=>calls.push(['hide',Array.from(ids)]),showAll:()=>calls.push(['all']),isolate:ids=>calls.push(['isolate',Array.from(ids)])};
 const view=new window.AgelAPS.BimView(renderer,model,{});
 view.isolate([]);assert.deepEqual(calls,[['hide',[1,2,3]]]);
 calls.length=0;view.isolate([2]);assert.deepEqual(calls,[['all'],['isolate',[2]]]);
});
