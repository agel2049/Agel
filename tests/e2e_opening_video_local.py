from ui_harness import local_page
with local_page('tests/fixtures/vm-local-videos.html') as pg:
 pg.wait_for_function('window.vmFixtureReady')
 result=pg.evaluate('''async()=>{
  await vmHandleVideo('opening',{target:{files:[new File([new Uint8Array(80*1024*1024)],'opening.webm',{type:'video/webm'})],value:''}});
  const url=document.getElementById('vmVidThumb').getAttribute('src');
  return {posts:posts.length,local:!!url?.startsWith('blob:'),bytes:url?.startsWith('blob:')?(await(await fetch(url)).blob()).size:0};
 }''')
 assert result=={'posts':0,'local':True,'bytes':80*1024*1024},result
 pg.reload();pg.wait_for_function('window.vmFixtureReady')
 assert pg.locator('#vmVidThumb').get_attribute('src').startswith('blob:')
 assert pg.evaluate("JSON.stringify(JSON.parse(localStorage.getItem('agelarq_vm'))).includes('blob:')")==False
 result=pg.evaluate('''async()=>{
  const before=document.getElementById('vmVidThumb').src,put=IDBObjectStore.prototype.put;messages=[];
  try{IDBObjectStore.prototype.put=function(v){if(this.name==='media')throw new DOMException('quota','QuotaExceededError');return put.call(this,v);};
   await vmHandleVideo('opening',{target:{files:[new File(['replacement'],'replace.mp4',{type:'video/mp4'})],value:''}});
   return {preserved:document.getElementById('vmVidThumb').src===before,falseSuccess:messages.some(x=>/guardado|listo/i.test(x)),quota:messages.some(x=>/espacio/i.test(x))};
  }finally{IDBObjectStore.prototype.put=put;}
 }''')
 assert result=={'preserved':True,'falseSuccess':False,'quota':True},result
 pg.evaluate("async()=>{owner='owner-b';await vmLoadLocalVideos();}")
 assert not (pg.locator('#vmVidThumb').get_attribute('src') or '').startswith('blob:')
 pg.evaluate("async()=>{owner='owner-a';await vmLoadLocalVideos();await vmRemoveVideo('opening');}")
 pg.reload();pg.wait_for_function('window.vmFixtureReady')
 assert not pg.locator('#vmVidThumb').get_attribute('src')
 assert pg.evaluate('posts')==[]
 print('PASS: 80 MiB Opening persists without upload, quota preserves video, accounts and removal')
