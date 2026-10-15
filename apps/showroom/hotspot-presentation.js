(function(root){
 'use strict';
 function mount(layer,{items}){
  for(const {el,hs}of items){const p=hs.presentation;if(!p||p.surface==='flat')continue;
   const inner=document.createElement('span');inner.className='sr-hs-inner';inner.append(...el.childNodes);el.append(inner);el.classList.add('sr-hs-oriented');
   inner.style.transform=`perspective(300px) rotateX(${p.tilt}deg) rotateZ(${p.rotation}deg) scale(${p.scale})`;inner.dataset.surface=p.surface;
  }return {dispose(){for(const {el}of items){const inner=el.querySelector('.sr-hs-inner');if(inner){el.append(...inner.childNodes);inner.remove();}el.classList.remove('sr-hs-oriented');}}};
 }
 root.AgelHotspotPresentation={mount};
})(window);
