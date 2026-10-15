const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../packages/showroom/relations.js');
test('public rejects local media',()=>assert.throws(()=>R.normalizeExperience({views:[{id:'f',image:'agel-local:abc'}]},[],[]),/local|sincroniz/));
test('closed zones must be simple',()=>assert.throws(()=>R.normalizeExperience({views:[{id:'f',image:'https://a.test/p.jpg',regions:[{points:[[0,0],[100,100],[0,100],[100,0]]}]}]},[],[]),/intersect|simple|área/i));
