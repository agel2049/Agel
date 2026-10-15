const test=require('node:test'),assert=require('node:assert/strict');
let C;try{C=require('../packages/showroom/catalog-import.js');}catch{C={};}
test('levels with the same name belong to different buildings',()=>{
 assert.equal(typeof C.parse,'function');
 const x=C.parse('grupo,nivel,nombre,clave\nA,1,Depto 101,A101\nB,1,Depto 101,B101\n');
 assert.equal(x.groups.length,2);assert.equal(x.levels.length,2);assert.notEqual(x.levels[0].key,x.levels[1].key);assert.equal(x.problems.length,0);
});
test('old CSV imports without guessing floors from unit names',()=>{
 const x=C.parse('grupo,nombre,clave,m2,recamaras,banos,estacionamientos,precio,mostrar_precio,estado\nA,Departamento 101 - Nivel 1,A101,78.5,2,1.5,1,1450000,no,disponible');
 assert.equal(x.levels.length,0);assert.equal(x.units[0].data.area_m2,78.5);assert.equal(x.units[0].data.show_price,false);
});
test('duplicate keys and invalid numeric fields are visible before any write',()=>{
 const x=C.parse('nombre,clave,m2,estado\nUno,A101,abc,vendida\nDos,a101,80,disponible\n');
 assert.ok(x.problems.some(p=>/duplicada/.test(p)));assert.ok(x.problems.some(p=>/superficie/.test(p)));
});
test('quoted separators, accents and unknown availability are handled',()=>{
 const x=C.parse('edificio;nivel;nombre;codigo;superficie;baños;estado\n"Torre; Norte";PB;"Depto, jardín";TN01;"78,5";2;desconocido');
 assert.equal(x.groups[0].name,'Torre; Norte');assert.equal(x.units[0].data.area_m2,78.5);assert.equal(x.units[0].data.availability,'no_aplica');
});
