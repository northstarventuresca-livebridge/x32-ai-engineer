/* X32 AI Engineer v105 — optional candidate post-EQ Dante feed for single-channel Check EQ.
   No X32 routing writes. Source/lane identity always operator-declared, never automatically verified. */
(()=>{
'use strict';
if(window.X32PostEQInput)return;
const RATE=16000, CAP=RATE*20;
const voice=document.querySelector('#x32-single-room')?.closest('label');
if(!voice)return;
const panel=document.createElement('section');
panel.id='x32-post-eq-meter';panel.style.cssText='border:1px solid #466b7a;border-radius:11px;background:#102936;padding:12px;margin:8px 0;color:#c7e4ea;font-size:12px';
panel.innerHTML='<label style="display:flex;gap:7px;align-items:center;font-weight:700;font-size:13px"><input id="x32-post-use" type="checkbox"> Compare direct mic with mixer output (after EQ)</label>'+
 '<div id="x32-post-controls" style="display:none;margin-top:10px">'+
 '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label>Output Dante source <select id="x32-post-device"><option value="">Choose DVS receive</option></select></label>'+
 '<label>Lane <select id="x32-post-lane"><option value="0">Left / odd Rx</option><option value="1">Right / even Rx</option></select></label>'+
 '<button type="button" id="x32-post-rescan">Rescan</button></div>'+
 '<div style="display:flex;gap:9px;align-items:center;margin-top:9px"><div style="flex:1;background:#263e49;max-width:450px;height:14px;border-radius:5px;overflow:hidden">'+
 '<div id="x32-post-fill" style="height:100%;background:#6fdabb;width:0%;transition:width .12s"></div></div>'+
 '<strong id="x32-post-db" style="min-width:65px">— dBFS</strong></div>'+
 '<div id="x32-post-state" role="status" style="color:#afc9d2;margin-top:6px">Select an output receive device and lane.</div>'+
 '<label style="display:block;margin-top:9px"><input id="x32-post-confirm" type="checkbox"> I confirm this receive lane is the selected channel AFTER X32 EQ</label>'+
 '<small style="display:block;color:#a8bdc9;margin-top:7px">This is an input declaration, not a verified mixer route. It must be a DIFFERENT audio feed from the direct microphone. Room mic is captured separately when selected. A moving meter alone does not prove post-EQ.</small></div>';
voice.after(panel);
const $=id=>document.getElementById(id),use=$('x32-post-use'),controls=$('x32-post-controls'),sel=$('x32-post-device'),lane=$('x32-post-lane'),
 level=$('x32-post-db'),fill=$('x32-post-fill'),info=$('x32-post-state'),confirm=$('x32-post-confirm');
let deviceId='',which=0,active=false,stream=null,ctx=null,source=null,processor=null,mute=null,timer=null,pending=null,token=0,
 ring=new Float32Array(CAP),index=0,amount=0,phase=0,sum=0,count=0,dbfs=-120,peak=-120,lastHeard=0;
const channel=()=>Number(window.X32StageReadback?.()?.channel)||0;
const storageKey=n=>'x32-post-dvs-ch'+n;
function show(msg){info.textContent=msg}
function resetRing(){ring=new Float32Array(CAP);index=0;amount=0;phase=0;sum=0;count=0;dbfs=-120;peak=-120;lastHeard=0}
function cleanup(){
 active=false;clearInterval(timer);timer=null;
 if(processor)processor.onaudioprocess=null;
 try{source?.disconnect();processor?.disconnect();mute?.disconnect()}catch{}
 for(const t of stream?.getTracks()||[])t.stop();
 ctx?.close().catch(()=>{});
 stream=null;ctx=null;source=null;processor=null;mute=null;resetRing();fill.style.width='0%';level.textContent='— dBFS';
}
function store(){
 if(!which)return;
 try{localStorage.setItem(storageKey(which),JSON.stringify({deviceId,lane:Number(lane.value),confirmed:confirm.checked}))}catch{}
}
function restore(n){
 which=n;deviceId='';lane.value='0';confirm.checked=false;
 if(!n)return;
 try{const prev=JSON.parse(localStorage.getItem(storageKey(n))||'{}');deviceId=typeof prev.deviceId==='string'?prev.deviceId:'';lane.value=prev.lane===1?'1':'0';confirm.checked=prev.confirmed===true}catch{}
}
async function scan(){
 let dvs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&/DVS|Dante/i.test(d.label));
 sel.replaceChildren();
 const none=document.createElement('option');none.value='';none.textContent='Select Dante receive device';sel.appendChild(none);
 for(const d of dvs){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'Dante receive device';sel.appendChild(o)}
 if(Array.from(sel.options).some(o=>o.value===deviceId))sel.value=deviceId;
 else{sel.value='';deviceId=''}
 if(!dvs.length)show('No DVS devices found. Keep routing unchanged; check Chrome microphone permission and DVS status.');
 return dvs;
}
async function ensure(n,signal){
 if(!use.checked)throw Error('Compare with mixer output is switched off.');
 if(!n||n!==channel())throw Error('Select the matching X32 microphone channel before comparing the output.');
 if(active&&which===n&&stream?.getAudioTracks()[0]?.readyState==='live')return;
 if(pending)return pending;
 const job=++token;
 pending=(async()=>{
  cleanup();restore(n);await scan();
  if(!deviceId){
   const auth=await navigator.mediaDevices.getUserMedia({audio:true});
   auth.getTracks().forEach(t=>t.stop());await scan();
  }
  if(signal?.aborted)throw new DOMException('Stopped','AbortError');
  if(!deviceId)throw Error('Select the Dante device that carries this X32 channel after EQ.');
  const opened=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId},channelCount:2,autoGainControl:false,echoCancellation:false,noiseSuppression:false}});
  if(job!==token||signal?.aborted){opened.getTracks().forEach(t=>t.stop());throw new DOMException('Cancelled','AbortError');}
  stream=opened;ctx=new AudioContext();source=ctx.createMediaStreamSource(stream);processor=ctx.createScriptProcessor(4096,2,1);mute=ctx.createGain();
  mute.gain.value=0;source.connect(processor);processor.connect(mute);mute.connect(ctx.destination);
  processor.onaudioprocess=e=>{
   if(job!==token||e.inputBuffer.numberOfChannels<=Number(lane.value))return;
   const pcm=e.inputBuffer.getChannelData(Number(lane.value)),step=ctx.sampleRate/RATE;
   let power=0,pk=0;
   for(let i=0;i<pcm.length;i++){
    const v=Number.isFinite(pcm[i])?pcm[i]:0;
    power+=v*v;pk=Math.max(pk,Math.abs(v));sum+=v;count++;phase++;
    if(phase>=step){ring[index]=sum/count;index=(index+1)%CAP;amount=Math.min(CAP,amount+1);phase-=step;sum=0;count=0;}
   }
   dbfs=20*Math.log10(Math.max(1e-9,Math.sqrt(power/pcm.length)));
   peak=Math.max(peak,20*Math.log10(Math.max(1e-9,pk)));
   if(dbfs>-84)lastHeard=Date.now();
  };
  await ctx.resume();if(job!==token)throw new DOMException('Cancelled','AbortError');
  active=true;
  timer=setInterval(()=>{
   if(!active)return;
   level.textContent=dbfs.toFixed(1)+' dBFS';fill.style.width=Math.max(0,Math.min(100,(dbfs+90)*1.36)).toFixed(1)+'%';
   show(lastHeard&&Date.now()-lastHeard<2200?
    'Output candidate audio is reaching Chrome. Post-EQ route still not independently verified.':
    'No current output signal. Confirm the selected DVS receive device and lane.');
  },170);
 })().catch(err=>{cleanup();show('Output capture unavailable: '+err.message);throw err}).finally(()=>{pending=null});
 return pending;
}
function sourceDetails(){return {deviceId,lane:Number(lane.value),deviceLabel:sel.selectedOptions?.[0]?.textContent||'',x32Channel:which,userConfirmed:confirm.checked,routeVerifiedByMixer:false}}
function snapshot(){
 if(!use.checked||!active)throw Error('Output Dante input not actively capturing.');
 if(which!==channel())throw Error('Output source channel differs from selected X32 channel.');
 if(amount<RATE*8)throw Error('Need at least 8 seconds of separate output audio before comparing.');
 if(!lastHeard||Date.now()-lastHeard>3500||peak<-82)throw Error('Output recording has insufficient signal. Make sure this DVS lane carries the post-EQ channel.');
 const n=Math.min(amount,RATE*12),pcm=new Float32Array(n);
 for(let i=0;i<n;i++)pcm[i]=ring[(index-n+i+CAP)%CAP];
 const buffer=new ArrayBuffer(44+n*2),view=new DataView(buffer),bytes=new Uint8Array(buffer);
 const word=(at,s)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i)};
 word(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);
 view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,RATE,true);view.setUint32(28,RATE*2,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,n*2,true);
 for(let i=0;i<n;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),true);
 return bytes;
}
function distinctFromDirect(a){
 const directId=a?.stream?.getAudioTracks?.()[0]?.getSettings?.()?.deviceId;
 if(directId&&directId===deviceId&&Number(lane.value)===Number(window.X32DanteLane?.(a.channel)))return false;
 return true;
}
function stop(){token++;cleanup();show('Output comparison off. X32 settings unchanged.')}
use.addEventListener('change',()=>{
 controls.style.display=use.checked?'block':'none';
 if(use.checked){restore(channel());scan().then(()=>{if(deviceId)ensure(channel()).catch(()=>{})}).catch(e=>show(e.message))}
 else stop();
});
sel.addEventListener('change',()=>{deviceId=sel.value;confirm.checked=false;store();token++;cleanup();if(use.checked&&deviceId)ensure(channel()).catch(()=>{})});
lane.addEventListener('change',()=>{confirm.checked=false;store();resetRing();show('Lane changed; gathering 8 seconds of fresh output audio.')});
confirm.addEventListener('change',store);
$('x32-post-rescan').onclick=()=>scan().catch(e=>show(e.message));
window.addEventListener('x32-channel-selected',e=>{
 const n=Number(e.detail?.channel);if(!use.checked)return;
 token++;cleanup();restore(n);scan().then(()=>{if(deviceId)ensure(n).catch(()=>{})}).catch(err=>show(err.message));
});
window.addEventListener('beforeunload',stop);
window.X32PostEQInput={ensure,snapshot,stop,source:sourceDetails,isActive:()=>active,distinctFromDirect};
})();