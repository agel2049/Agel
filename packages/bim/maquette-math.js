/* Camera poses and physical maquette sizing; no browser or renderer state. */
(function(root){
 'use strict';
 const poses={iso:{direction:[1,.65,1.5],up:[0,1,0]},top:{direction:[0,1,0],up:[0,0,-1]},front:{direction:[0,0,1],up:[0,1,0]},right:{direction:[1,0,0],up:[0,1,0]}};
 function view(name){if(!Object.hasOwn(poses,name))throw Error('Vista de maqueta desconocida');return {direction:[...poses[name].direction],up:[...poses[name].up]};}
 function scaleFor(extent,size=1){if(!Number.isFinite(extent)||extent<=0||!Number.isFinite(size)||size<.1||size>2)throw Error('El tamaño de maqueta no es válido');const scale=size/extent;if(!Number.isFinite(scale)||scale<=0)throw Error('La escala del modelo no es válida');return scale;}
 const api={view,scaleFor};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelMaquetteMath=api;
})(typeof window!=='undefined'?window:globalThis);
