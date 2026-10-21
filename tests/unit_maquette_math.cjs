const {test}=require('node:test');
const assert=require('node:assert/strict');
let math;try{math=require('../packages/bim/maquette-math.js');}catch{}
test('maquette views have stable directions and a non-singular top up vector',()=>{
 assert.equal(typeof math?.view,'function');
 assert.deepEqual(math.view('top'),{direction:[0,1,0],up:[0,0,-1]});
 assert.deepEqual(math.view('front').direction,[0,0,1]);
 assert.deepEqual(math.view('right').direction,[1,0,0]);
 assert.deepEqual(math.view('iso').up,[0,1,0]);
 assert.throws(()=>math.view('invented'));
});
test('AR maquette size is finite, proportional and rejects invalid sizes',()=>{
 assert.equal(typeof math?.scaleFor,'function');
 assert.equal(math.scaleFor(20,1),.05);
 assert.equal(math.scaleFor(.02,.5),25);
 for(const n of [0,-1,NaN,Infinity])assert.throws(()=>math.scaleFor(n,1));
 for(const n of [0,-1,NaN,Infinity,100])assert.throws(()=>math.scaleFor(20,n));
});
