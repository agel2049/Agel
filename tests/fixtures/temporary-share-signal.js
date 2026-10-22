/* Test-only polling signal. Actual RTCPeerConnection and DataChannels stay native. */
(function(){
 let serial=0;
 window.AgelShareSignal={async open({projectId,sessionId,onMessage}){
  const id=crypto.randomUUID(),room=projectId+':'+sessionId;let closed=false,cursor=0,timer;
  async function poll(){if(closed)return;try{const r=await fetch('/_share_signal?room='+room+'&from='+id+'&after='+cursor);const data=await r.json();for(const item of data){cursor=Math.max(cursor,item.id);if(item.from!==id)onMessage(item.message);}}finally{if(!closed)timer=setTimeout(poll,30);}}
  poll();return {async send(message){if(closed)return;await fetch('/_share_signal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,from:id,message})});},close(){closed=true;clearTimeout(timer);}};
 }};
})();
