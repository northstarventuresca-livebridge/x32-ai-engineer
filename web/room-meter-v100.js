/* Shared optional room audio meter and capture source.
 * X32 room microphone is CH28 from physical Input 15 (operator-identified).
 * DVS receive pair/lane is NOT proven by that identification.
 * Both single and multi check EQ use this same monitored audio. */
(()=>{
'use strict';
if(window.X32RoomInput)return;
const RATE=16000,CAP=RATE*20;
const checks=['x32-single-room','x32-multi-room'].map(id=>document.getElementById(id)).filter(Boolean);
const U=document.createElement('section');
U.id='x32-room-meter';U.style.cssText='border:1px solid #416270;border-radius:9px;background:#102936;padding:10px;margin:10px 0;display:none;font-size:12px;color:#c6e8eb';
U.innerHTML='<strong>Room mic · X32 CH28 / physical Input 15</strong>'+
'<div style="margin:7px 0;display:flex;flex-wrap:wrap;gap:7px;align-items:center">'+
'<label>Audio source <select id="x32-room-source" style="max-width:220px"><option value="">Choose DVS receive device</option></select></label>'+
'<label>Lane <select id="x32-room-lane"><option value="0">Left / odd Rx</option><option value="1">Right / even Rx</option></select></label>'+
'<button type="button" id="x32-room-refresh">Rescan</button></div>'+
'<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:80px;background:#263d4b;border-radius:5px;overflow:hidden;height:14px"><div id="x32-room-fill" style="height:14px;width:0%;background:#53d1a2;transition:width .12s"></div></div><b id="x32-room-db" style="min-width:64px">— dBFS</b></div>'+
'<div id="x32-room-state" style="color:#b7d1dd;margin-top:6px">Room mic OFF</div>'+
'<small style="display:block;color:#9db7c5;margin-top:5px">Activity meter confirms incoming audio only. To verify it is the room mic, speak near CH28 and watch the meter. Dante routing and post-EQ tap remain unverified.</small>';
const multi=document.getElementById('x32-multi-room');
const single=document.getElementById('x32-single-room');
const insertion=multi?.closest('label')||single?.closest('label');
insertion?.after(U);
const $=id=>document.getElementById(id);
const select=$('x32-room-source'),lane=$('x32-room-lane'),fill=$('x32-room-fill'),db=$('x32-room-db'),state=$('x32-room-state');
let deviceId='',active=false,stream=null,ctx=null,input=null,proc=null,mute=null,timer=null,pending=null,generation=0;
let ring=new Float32Array(CAP),cursor=0,total=0,phase=0,sum=0,n=0,lastDb=-120,lastHeard=0;
function label(s){state.textContent=s;}
function update(){if(!active)return;const width=Math.min(100,Math.max(0,(lastDb+90)*1.35));fill.style.width=width.toFixed(1)+'%';db.textContent=lastDb.toFixed(1)+' dBFS';const live=lastHeard&&Date.now()-lastHeard<2000;label(live?'Audio detected · selected DVS lane (room source identity unverified)':'No audible-level input yet · verify CH28 room microphone and chosen DVS lane');}
function clearRing(){ring=new Float32Array(CAP);cursor=0;total=0;phase=0;sum=0;n=0;lastDb=-120;lastHeard=0;}
function endAudio(){active=false;clearInterval(timer);timer=null;proc&&(proc.onaudioprocess=null);try{input?.disconnect();proc?.disconnect();mute?.disconnect()}catch{}stream?.getTracks().forEach(t=>t.stop());ctx?.close().catch(()=>{});stream=null;ctx=null;input=null;proc=null;mute=null;fill.style.width='0%';db.textContent='— dBFS';}
async function scan(){
 const inputs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
 select.replaceChildren();
 const opt=document.createElement('option');opt.value='';opt.textContent='Select DVS audio device';select.appendChild(opt);
 const dvs=inputs.filter(d=>/DVS|Dante/i.test(d.label));
 for(const d of dvs){
  const option=document.createElement('option');option.value=d.deviceId;option.textContent=d.label||'DVS microphone device';select.appendChild(option);
 }
 const remembered=Array.from(select.options).find(o=>o.value===deviceId);
 if(deviceId&&remembered)select.value=deviceId;
 else{
  const candidate=dvs.find(d=>/Receive\s*3\s*[-–]\s*4|Rx\s*3\s*[-–]\s*4/i.test(d.label));
  if(candidate){select.value=candidate.deviceId;deviceId=candidate.deviceId;}
  else{select.value='';deviceId='';}
 }
 if(!dvs.length)label('No Dante Virtual Soundcard receive devices detected. Enable DVS and allow Chrome microphone access.');
 return dvs.length;
}
async function ensure(){
 if(!checks.some(c=>c.checked))throw Error('Use Room Mic is switched off');
 if(active&&stream?.getAudioTracks()[0]?.readyState==='live')return;
 if(pending)return pending;
 const token=++generation;
 pending=(async()=>{
  await scan();
  if(!deviceId){
   const permission=await navigator.mediaDevices.getUserMedia({audio:true});
   permission.getTracks().forEach(t=>t.stop());
   await scan();
  }
  if(!deviceId)throw Error('Choose a Dante Virtual Soundcard receive device for the room mic');
  const opened=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId},channelCount:2,autoGainControl:false,echoCancellation:false,noiseSuppression:false}});
  if(token!==generation){opened.getTracks().forEach(t=>t.stop());throw Error('Room meter start superseded')}
  stream=opened;ctx=new AudioContext();input=ctx.createMediaStreamSource(opened);proc=ctx.createScriptProcessor(4096,2,1);mute=ctx.createGain();mute.gain.value=0;
  clearRing();input.connect(proc);proc.connect(mute);mute.connect(ctx.destination);
  proc.onaudioprocess=e=>{
   if(token!==generation)return;
   const channel=Number(lane.value);
   if(e.inputBuffer.numberOfChannels<=channel){label('Selected DVS stereo lane missing');return;}
   const data=e.inputBuffer.getChannelData(channel),step=ctx.sampleRate/RATE;
   let power=0;
   for(let i=0;i<data.length;i++){
    const v=Number.isFinite(data[i])?data[i]:0;power+=v*v;sum+=v;n++;phase++;
    if(phase>=step){ring[cursor]=sum/n;cursor=(cursor+1)%CAP;total=Math.min(CAP,total+1);phase-=step;sum=0;n=0;}
   }
   lastDb=20*Math.log10(Math.max(1e-9,Math.sqrt(power/data.length)));
   if(lastDb>-83)lastHeard=Date.now();
  };
  await ctx.resume();if(token!==generation)throw Error('Room meter cancelled');
  active=true;timer=setInterval(update,180);update();
 })().catch(e=>{endAudio();label('Room mic unavailable: '+e.message);throw e}).finally(()=>{pending=null});
 return pending;
}
function stop(){generation++;endAudio();label('Room mic OFF');}
function wav(pcm){
 const buffer=new ArrayBuffer(44+pcm.length*2),v=new DataView(buffer),b=new Uint8Array(buffer);
 const word=(p,s)=>{for(let i=0;i<s.length;i++)b[p+i]=s.charCodeAt(i)};
 word(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,RATE,true);v.setUint32(28,RATE*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),true);
 return new Uint8Array(buffer);
}
function snapshot(){
 if(!active)throw Error('Room mic not running. Enable Use Room Mic and verify the live meter first.');
 if(total<RATE*8)throw Error('Room input has fewer than 8 seconds of audio. Keep Room Mic enabled while speaking or singing.');
 if(!lastHeard||Date.now()-lastHeard>5000)throw Error('Room meter has not detected sound recently. Verify microphone and DVS lane.');
 const count=Math.min(total,RATE*12),samples=new Float32Array(count);
 for(let i=0;i<count;i++)samples[i]=ring[(cursor-count+i+CAP)%CAP];
 return wav(samples);
}
function switchChecked(enabled,origin){
 const near=origin?.closest('label');if(near)near.after(U);
 for(const c of checks)c.checked=enabled;
 U.style.display=enabled?'block':'none';
 if(enabled)ensure().catch(()=>{});else stop();
}
for(const c of checks)c.addEventListener('change',()=>switchChecked(c.checked,c));
select.addEventListener('change',()=>{deviceId=select.value;if(checks.some(c=>c.checked)){endAudio();ensure().catch(()=>{})}});
lane.addEventListener('change',()=>{if(active){clearRing();label('Room lane changed. Confirm meter response and gather 8 seconds of audio.');}});
$('x32-room-refresh').onclick=()=>{scan().then(()=>{if(checks.some(c=>c.checked)){endAudio();ensure().catch(()=>{})}}).catch(e=>label(e.message))};
window.addEventListener('beforeunload',stop);
window.X32RoomInput={ensure,snapshot,stop,isActive:()=>active,level:()=>lastDb,source:()=>({deviceLabel:select.selectedOptions?.[0]?.textContent||'',lane:Number(lane.value),mixerChannel:28,physicalInput:15,confirmedDanteMapping:false})};
})();