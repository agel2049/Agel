(function(root){
 'use strict';const {h,modal,notify}=AgelDOM;
 root.AgelMediaControls={mount(container,{workspace}){
  const status=h('span',{role:'status',class:'pn-muted'}),refresh=()=>status.textContent=workspace.dirty?'Borrador en este dispositivo · pendiente de nube':'Contenido sincronizado';refresh();
  const run=async fn=>{try{await fn();refresh();}catch(e){notify(e.message,'error');}};
  const restore=h('input',{type:'file',multiple:true,hidden:true});restore.onchange=()=>run(async()=>{
   const files=[...restore.files],manifestFile=files.find(f=>f.name==='agelarq-respaldo.json');if(!manifestFile)throw Error('Selecciona agelarq-respaldo.json y los archivos del respaldo');
   await AgelLocalBackup.importProject(workspace.store,JSON.parse(await manifestFile.text()),files.filter(f=>f!==manifestFile));location.reload();
  });
  container.append(h('div',{class:'pn-toolbar pn-local-controls'},status,
   h('a',{class:'ag-btn',href:'../showroom/?local='+encodeURIComponent(workspace.projectId),target:'_blank',rel:'noopener'},'Vista previa local'),
   h('button',{class:'ag-btn',onclick:()=>run(async()=>AgelLocalBackup.exportProject(workspace.store,await workspace.load()))},'Respaldar archivos locales'),
   h('button',{class:'ag-btn',onclick:()=>restore.click()},'Restaurar respaldo'),restore,
   h('button',{class:'ag-btn primary',onclick:()=>run(async()=>{
    if(!root.AgelSync)throw Error('La sincronización todavía no está disponible');
    const plan=await AgelSync.plan(await workspace.load(),workspace.store);
    const controller=new AbortController(),pause=h('button',{class:'ag-btn',onclick:()=>controller.abort()},'Pausar sincronización');
    const m=modal({title:'Subir a la nube',body:[pause,h('p',null,`${plan.assets.length} archivos · ${AgelDOM.formatBytes(plan.totalBytes)}`),h('p',null,'Los originales se conservan en este dispositivo.'),h('ul',null,plan.blocked.map(x=>h('li',null,x)))],
     actions:[{label:'Cancelar',onClick:()=>m.close()},{label:'Confirmar subida',primary:true,disabled:!!plan.blocked.length,onClick:async()=>{if(plan.blocked.length)return;m.setBusy(true);try{await AgelSync.run({workspace,cloud:workspace.cloud,signal:controller.signal,onProgress:text=>status.textContent=text});m.close();refresh();notify('Contenido sincronizado');}catch(e){m.setBusy(false);notify(e.message,'error');}}}]});
   })},'Subir a la nube')));return {refresh};
 }};
})(window);
