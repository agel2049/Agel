(function(root){
 'use strict';
 const eps=1e-8,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const between=(a,b,c)=>Math.abs(cross(a,b,c))<eps&&c[0]>=Math.min(a[0],b[0])-eps&&c[0]<=Math.max(a[0],b[0])+eps&&c[1]>=Math.min(a[1],b[1])-eps&&c[1]<=Math.max(a[1],b[1])+eps;
 const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-eps&&cross(c,d,a)*cross(c,d,b)<-eps||between(a,b,c)||between(a,b,d)||between(c,d,a)||between(c,d,b);
 function simple(p){for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
  if(j===i+1||i===0&&j===p.length-1)continue;
  if(intersects(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]))return false;
 }return true;}
 function validatePolygon(points,{w=100,h=100}={}){
  if(!Array.isArray(points)||points.length<3||points.length>80)return {valid:false,reason:'La zona necesita entre 3 y 80 vértices'};
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return {valid:false,reason:'Dimensiones inválidas'};
  if(points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>100)))return {valid:false,reason:'Vértice fuera de la imagen'};
  if(points.some((p,i)=>dist(p,points[(i+1)%points.length])<eps))return {valid:false,reason:'Hay vértices repetidos'};
  const area=Math.abs(points.reduce((a,p,i)=>{const q=points[(i+1)%points.length];return a+p[0]*q[1]-q[0]*p[1];},0))/2;
  if(area<eps)return {valid:false,reason:'El área de la zona es cero'};
  if(!simple(points))return {valid:false,reason:'El contorno de la zona se cruza'};
  return {valid:true,reason:''};
 }
 const snapPoint=(a,b,on)=>!on||!a?b.slice():Math.abs(b[0]-a[0])>=Math.abs(b[1]-a[1])?[b[0],a[1]]:[a[0],b[1]];
 const fmt=p=>p.map(n=>Number(n.toFixed(4))).join(' ');
 function roundedGeometry(points,{w,h,radius=0}){
  const valid=validatePolygon(points,{w,h});if(!valid.valid)throw new Error(valid.reason);
  if(!Number.isFinite(radius)||radius<0||radius>2)throw new Error('Radio fuera del intervalo 0–2');
  const p=points.map(([x,y])=>[x*w/100,y*h/100]);
  const straight=()=>({d:`M ${fmt(p[0])} ${p.slice(1).map(q=>`L ${fmt(q)}`).join(' ')} Z`,radius:0});
  if(!radius)return straight();
  for(let attempt=0;attempt<12;attempt++){
   const rr=radius/2**attempt,r=rr*Math.min(w,h)/100;
   const corners=p.map((v,i)=>{
    const a=p[(i+p.length-1)%p.length],b=p[(i+1)%p.length],la=dist(v,a),lb=dist(v,b),d=Math.min(r,la/2,lb/2);
    return {v,in:[v[0]+(a[0]-v[0])*d/la,v[1]+(a[1]-v[1])*d/la],out:[v[0]+(b[0]-v[0])*d/lb,v[1]+(b[1]-v[1])*d/lb]};
   });
   const sampled=[];
   for(const c of corners)for(let j=0;j<=8;j++){const t=j/8;sampled.push([0,1].map(k=>(1-t)**2*c.in[k]+2*(1-t)*t*c.v[k]+t*t*c.out[k]));}
   // Adjacent half-edge joins can coincide; omit duplicates before intersection testing.
   const unique=sampled.filter((q,i)=>!i||dist(q,sampled[i-1])>eps);
   if(dist(unique[0],unique.at(-1))<eps)unique.pop();
   if(!simple(unique))continue;
   return {d:`M ${fmt(corners[0].in)} `+corners.map((c,i)=>`${i?'L '+fmt(c.in)+' ':''}Q ${fmt(c.v)} ${fmt(c.out)}`).join(' ')+' Z',radius:rr};
  }return straight();
 }
 const roundedPath=(p,o)=>roundedGeometry(p,o).d;
 function imagePoint(event,rect){const x=(event.clientX-rect.left)/rect.width*100,y=(event.clientY-rect.top)/rect.height*100;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>100||y<0||y>100)return null;return [x,y].map(n=>Math.round(n*100)/100);
 }
 const api={snapPoint,validatePolygon,roundedPath,roundedGeometry,imagePoint};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelShowroomGeometry=api;
})(typeof window!=='undefined'?window:globalThis);
