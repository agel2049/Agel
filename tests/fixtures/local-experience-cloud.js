/* Test-only read API. Any write attempt fails and is counted across tabs. */
(function(){
 const project='10000000-0000-4000-8000-000000000001',level='10000000-0000-4000-8000-000000000002';
 const image='https://fixture.agelarq.test/planta.jpg';
 const tree={role:'owner',revision:1,project:{id:project,name:'Edificio local',kind:'edificio',showroom:{views:[
  {id:'f',title:'Fachada',image,w:1600,h:900,role:'facade',regions:[],spots:[]},
  {id:'l',title:'Lobby',image,w:1600,h:900,role:'lobby',regions:[],spots:[]},
  {id:'n',title:'Planta Nivel 1',image,w:1600,h:900,role:'floor',spaceId:level,regions:[],spots:[]}]}},scenes:[]};
 const listeners=new Set(),write=name=>{const writes=JSON.parse(localStorage.getItem('fixtureWrites')||'[]');writes.push(name);localStorage.setItem('fixtureWrites',JSON.stringify(writes));throw Error('Unexpected cloud write: '+name);};
 const cloud={storageKey:'agel.session',get user(){return {id:localStorage.getItem('fixtureOwner')||'owner',email:'fixture@example.test'};},get session(){return {user:this.user};},
  onAuth(fn){listeners.add(fn);return()=>listeners.delete(fn);},consumeRedirect(){},
  async rpc(name){if(name==='my_access')return {orgs:[{id:'org',name:'Estudio',role:'owner'}],projects:[{id:project,org_id:'org',name:'Edificio local',role:'owner'}]};if(name==='load_workspace_settings')return {};if(name==='load_project_tree')return structuredClone(tree);return write(name);},
  async select(table){return table==='spaces'?[{id:level,kind:'nivel',name:'Nivel 1',project_id:project,scene_ids:[]}]:[];},
  async upload(){return write('upload');},async insert(){return write('insert');},async update(){return write('update');},async invoke(){return write('invoke');}};
 window.AgelCloud={client:()=>cloud};window.fixtureChangeOwner=owner=>{localStorage.setItem('fixtureOwner',owner);for(const fn of listeners)fn(cloud.session);};
})();
