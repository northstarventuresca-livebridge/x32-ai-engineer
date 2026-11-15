/* Computer Program EQ: CH26 Mac Input5 and CH27 Windows Input6.
 * Browser source mapping MUST be chosen from actual Dante receive devices and heard/confirmed by operator.
 * Never infer Dante routing from X32 physical input numbers. */
(()=>{
'use strict';
const specs={26:{name:'Mac Audio',input:5},27:{name:'Windows PC Audio',input:6}},SAMPLES=16000*12;
const panel=document.createElement('section');panel.id='x32-playback-panel';panel.style.cssText='margin:14px 0;padding:16px;background:#102735;border:1px solid #52728a;border-radius:14px;color:#e4eef3';
panel.innerHTML='<h2 style="margin:0 0 7px">Computer Audio EQ</h2>'+
 '<p style="font-size:12px;color:#b5ced9;margin:5px 0 10px">Mac CH26 / board Input 5 · Windows PC CH27 / board Input 6. These are X32 channel assignments, NOT proven Dante receive mappings.</p>'+
 '<div style="display:flex;flex-wrap:wrap;gap:9px;margin:9px 0"><button type="button" id="x32-pb-mac">CH26 · Mac Audio</button><button type="button" id="x32-pb-pc">CH27 · Windows PC</button></div>'+
 '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:7px 0"><label>Listen from <select id="x32-pb-device"><option value="">Choose Dante receive device</option></select></label><label>Lane <select id="x32-pb-lane"><option value="0">Left / odd Rx</option><option value="1">Right / even Rx</option></select></label><button type="button" id="x32-pb-rescan">Rescan</button></div>'+
 '<div style="display:flex;align-items:center;gap:10px;margin:8px 0"><div style="background:#24404d;flex:1;height:14px;border-radius:5px;overflow:hidden;max-width:340px"><div id="x32-pb-meter" style="height:100%;width:0;background:#70d9af"></div></div><b id="x32-pb-db" style="font-size:12px">— dBFS</b></div>'+
 '<label style="font-size:12px;color:#d8eaf0;display:block;margin:7px 0"><input id="x32-pb-confirm" type="checkbox"> I confirmed this meter follows the selected computer output</label>'+
 '<label style="font-size:13px;color:#cce4e8;display:block;margin:9px 0"><input id="x32-playback-room" type="checkbox"> Use Room Mic (optional) <small style="display:block;color:#a1becb;margin-left:20px">Room mic X32 CH28 / Input 15. Room meter below must detect sound. Other PA sources should be quiet for meaningful playback-to-room comparison.</small></label>'+
 '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:10px 0"><button type="button" id="x32-pb-check">Check Computer EQ</button><button type="button" id="x32-pb-stop" disabled>Stop Listening</button><button type="button" id="x32-pb-play" disabled>Play Captured Sample</button></div>'+
 '<p role="status" id="x32-pb-status" style="font-size:12px;color:#afd9dc">Choose CH26 or CH27. No computer input monitored yet.</p>'+
 '<div id="x32-pb-results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px"></div>'+
 '<p style="font-size:11px;color:#9cb9c5">Always listen to the source alone during room-based checks. During a worship set the room mic hears the entire mix, so its recording cannot be attributed to one computer. EQ curves are modeled, not verified post-EQ audio.</p>';
(document.getElementById('x32-multi-panel')||document.getElementById('x32-quick'))?.after(panel);
const $=id=>document.getElementById(id),status=txt=>{$('x32-pb-status').textContent=txt};
let selected=0,stream=null,ctx=null,sourceNode=null,processor=null,mute=null,meterTimer=null,latestDb=-120,deviceId='',lane=0,
 measurement=null,record=null,run=null,applying=false,playUrl=null,seq=0;
const reports=new Map();
const storageKey=ch=>'x32-pb-source-'+ch;
function srcFromStorage(ch){try{return JSON.parse(localStorage.getItem(storageKey(ch))||'{}')}catch{return{}}}
function storeSource(){if(!selected)return;const data={deviceId,lane,confirmed:$('x32-pb-confirm').checked};try{localStorage.setItem(storageKey(selected),JSON.stringify(data))}catch{}}
function updateButtons(){
 for(const ch of [26,27]){
  const b=$(ch===26?'x32-pb-mac':'x32-pb-pc');b.style.borderColor=selected===ch?'#68d8ae':'#43576a';
  b.setAttribute('aria-pressed',String(selected===ch));
 }
 $('x32-pb-check').disabled=!selected||!deviceId||!!run||applying||!stream;
 $('x32-pb-stop').disabled=!run;
 for(const id of ['x32-pb-device','x32-pb-lane','x32-pb-mac','x32-pb-pc'])$(id).disabled=!!run||applying;
}
function closeDevice(){
 clearInterval(meterTimer);meterTimer=null;measurement?.reject?.(new Error('Audio device changed while recording'));measurement=null;
 if(processor)processor.onaudioprocess=null;
 try{sourceNode?.disconnect();processor?.disconnect();mute?.disconnect()}catch{}
 stream?.getTracks().forEach(t=>t.stop());ctx?.close().catch(()=>{});
 stream=null;ctx=null;sourceNode=null;processor=null;mute=null;latestDb=-120;
 $('x32-pb-meter').style.width='0%';$('x32-pb-db').textContent='— dBFS';
}
const validDevice=d=>/DVS|Dante/i.test(d.label||'');
async function scan(){
 const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&validDevice(d));
 const sel=$('x32-pb-device');sel.replaceChildren();
 const blank=document.createElement('option');blank.value='';blank.textContent='Select Dante receive';sel.appendChild(blank);
 for(const d of devices){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||'Dante input';sel.appendChild(o)}
 if(Array.from(sel.options).some(o=>o.value===deviceId))sel.value=deviceId;
 else{sel.value='';deviceId=''}
 return devices.length;
}
async function openDevice(){
 const token=++seq;closeDevice();
 if(!selected||!deviceId)return;
 status('Opening selected Dante capture lane · source routing not yet proven…');
 let media;
 try{
  media=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId},channelCount:2,autoGainControl:false,echoCancellation:false,noiseSuppression:false}});
  if(token!==seq){media.getTracks().forEach(t=>t.stop());return}
  stream=media;ctx=new AudioContext();sourceNode=ctx.createMediaStreamSource(stream);processor=ctx.createScriptProcessor(4096,2,1);mute=ctx.createGain();
  mute.gain.value=0;sourceNode.connect(processor);processor.connect(mute);mute.connect(ctx.destination);
  processor.onaudioprocess=event=>{
   if(token!==seq||!selected)return;
   if(event.inputBuffer.numberOfChannels<=lane){status('Selected Dante lane not present in capture.');return}
   const data=event.inputBuffer.getChannelData(lane);let p=0,pk=0;
   for(let i=0;i<data.length;i++){const x=data[i];p+=x*x;pk=Math.max(pk,Math.abs(x))}
   latestDb=20*Math.log10(Math.max(1e-9,Math.sqrt(p/data.length)));
   if(measurement){
    const m=measurement;
    const active=latestDb>Math.max(-84,m.floor+8)&&pk>.00013;
    if(!m.started){m.floor=Math.min(m.floor,latestDb);if(!active)return;m.started=true}
    if(active)m.activeSec+=data.length/ctx.sampleRate;
    m.peak=Math.max(m.peak,20*Math.log10(Math.max(1e-9,pk)));
    const step=ctx.sampleRate/16000;
    for(let i=0;i<data.length&&m.samples.length<SAMPLES;i++){
     m.sum+=data[i];m.count++;m.phase++;
     if(m.phase>=step){m.samples.push(m.sum/m.count);m.sum=0;m.count=0;m.phase-=step}
    }
    if(m.samples.length>=SAMPLES){
     if(m.activeSec>=3&&m.peak>-65){measurement=null;m.resolve(m.samples.slice(0,SAMPLES))}
     else{
      m.samples.length=0;m.started=false;m.activeSec=0;m.peak=-120;m.sum=0;m.count=0;m.phase=0;m.floor=-92;
      status('Computer output was mostly silent. Waiting for a clearer sample…');
     }
    }
   }
  };
  await ctx.resume();if(token!==seq)return;
  meterTimer=setInterval(()=>{
   if(token!==seq)return;
   $('x32-pb-db').textContent=latestDb.toFixed(1)+' dBFS';
   $('x32-pb-meter').style.width=Math.max(0,Math.min(100,(latestDb+90)*1.4)).toFixed(1)+'%';
  },180);
  status('Dante meter active for '+specs[selected].name+'. Play audio from this source and confirm the meter follows it.');
 }catch(e){if(token!==seq)return;closeDevice();status('Could not monitor Dante input: '+e.message)}
 finally{updateButtons()}
}
async function choose(ch){
 if(!specs[ch]||applying||run)return;
 selected=ch;seq++;closeDevice();measurement=null;
 const saved=srcFromStorage(ch);deviceId=typeof saved.deviceId==='string'?saved.deviceId:'';lane=saved.lane===1?1:0;
 $('x32-pb-lane').value=String(lane);$('x32-pb-confirm').checked=saved.confirmed===true;
 await scan();updateButtons();
 if(deviceId)await openDevice();else status('CH'+ch+' '+specs[ch].name+' · Input '+specs[ch].input+'. Choose and verify its DVS receive device and left/right lane.');
 renderCard(ch);updateButtons();
}
function wav(samples){
 const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer),b=new Uint8Array(buffer);
 const word=(at,t)=>{for(let i=0;i<t.length;i++)b[at+i]=t.charCodeAt(i)};
 word(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++)v.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
 return b;
}
function to64(buffer){let s='';for(let i=0;i<buffer.length;i+=12000)s+=String.fromCharCode(...buffer.subarray(i,i+12000));return btoa(s)}
const key=()=>$('x32-key')?.value?.trim()||'';
async function bridge(route,method='GET',body){
 if(!key())throw Error('Connect local Windows X32 bridge and enter its bridge key');
 const r=await fetch('http://127.0.0.1:8792'+route,{method,headers:{'X-Bridge-Key':key(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),cache:'no-store'});
 const data=await r.json().catch(()=>({error:'Local bridge reply not JSON'}));if(!r.ok)throw Error(data.error||'Bridge HTTP '+r.status);return data;
}
function eqSame(a,b){
 if(!a||!b||a.channel!==b.channel||a.eqOn!==b.eqOn||a.hpf?.on!==b.hpf?.on||!Array.isArray(a.bands)||!Array.isArray(b.bands)||a.bands.length!==4||b.bands.length!==4)return false;
 if(a.hpf?.on&&(!Number.isFinite(a.hpf.frequencyHz)||!Number.isFinite(b.hpf.frequencyHz)||Math.abs(a.hpf.frequencyHz-b.hpf.frequencyHz)>Math.max(2,a.hpf.frequencyHz*.015)))return false;
 return a.bands.every((x,i)=>{const y=b.bands[i];return x.type===y.type&&Math.abs(x.frequencyHz-y.frequencyHz)<=Math.max(3,x.frequencyHz*.018)&&Math.abs(x.gainDb-y.gainDb)<=.24&&Math.abs(x.q-y.q)<=.05});
}
function eqGraph(before,suggest){
 const after=before.bands.map(x=>({...x}));
 for(const s of suggest){const b=after[s.band-1];if(b)Object.assign(b,s)}
 const response=(bands,f)=>{
  let sum=0;for(const b of bands){
   const fq=Math.max(20,Math.min(20000,b.frequencyHz)),q=Math.max(.3,Math.min(10,b.q)),z=Math.log2(f/fq),g=b.gainDb;
   if(b.type==='HCut')sum+=-10*Math.log10(1+Math.pow(f/fq,8));
   else if(b.type==='LCut')sum+=-10*Math.log10(1+Math.pow(fq/f,8));
   else if(b.type==='HShv')sum+=g/(1+Math.exp(-5*z));
   else if(b.type==='LShv')sum+=g/(1+Math.exp(5*z));
   else sum+=g*Math.exp(-.5*Math.pow(z/(.7/q),2));
  }return Math.max(-20,Math.min(20,sum));
 };
 const trace=bands=>Array.from({length:141},(_,i)=>{const f=40*Math.pow(18000/40,i/140),db=response(bands,f);return(i?'L':'M')+(37+3.78*i).toFixed(1)+','+(102-db*1.95).toFixed(1)}).join(' ');
 const shell=document.createElement('div');shell.style.cssText='padding:8px;border:1px solid #45636c;border-radius:9px;background:#0a1d28;margin:8px 0';
 const legend=document.createElement('div');legend.style.cssText='display:flex;gap:13px;font-size:11px;font-weight:700';
 for(const [name,color] of [['━━ Current EQ','#ff7373'],['━━ Suggested EQ','#61eba1']]){const s=document.createElement('span');s.style.color=color;s.textContent=name;legend.appendChild(s)}
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 584 147');svg.style.cssText='width:100%;height:auto';
 for(const [bands,color,weight] of [[before.bands,'#fc5353','4.5'],[after,'#5dea94','2.8']]){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',trace(bands));p.setAttribute('fill','none');p.setAttribute('stroke',color);p.setAttribute('stroke-width',weight);svg.appendChild(p)}
 const note=document.createElement('small');note.textContent='Modeled EQ curves only; not measured before/after PA audio.';note.style.color='#abbdc6';shell.append(legend,svg,note);return shell;
}
function renderCard(ch){
 const box=$('x32-pb-results');let card=box.querySelector('[data-channel="'+ch+'"]');
 if(!card){card=document.createElement('section');card.dataset.channel=ch;card.style.cssText='background:#0b202c;border:1px solid #446070;border-radius:11px;padding:12px';box.appendChild(card)}
 card.replaceChildren();
 const head=document.createElement('strong');head.textContent='CH'+ch+' · '+specs[ch].name+' · Input '+specs[ch].input;
 const m=document.createElement('div');m.style.cssText='font-size:12px;color:#c6dfe8;margin:7px 0;white-space:pre-line';
 const apply=document.createElement('button');apply.type='button';apply.textContent='Apply EQ to CH'+ch;apply.disabled=true;
 card.append(head,m,apply);const data=reports.get(ch);
 if(!data){m.textContent='No computer audio analysis yet.';return}
 const r=data.review;
 const description=[r.summary||'No summary',...((r.audibleFindings||[]).map(x=>'• '+x))];
 if(r.roomMicUsed){
  description.push('ROOM heard: '+(r.roomAssessment?.audibleRoomObservations||'Not confirmed'));
  description.push('ROOM influence on EQ: '+(r.roomAssessment?.impactOnEQ||'Not confirmed'));
  description.push('ROOM limitation: '+(r.roomAssessment?.limitations||'Unverified room feed'));
 }
 if(data.applied)description.push('APPLIED AND VERIFIED on X32. Listen in the room; post-EQ audio capture remains unverified.');
 if(!r.reviewComplete&&!data.applied)description.push('EQ NOT ready to apply. The AI did not return a sufficiently safe four-band recommendation.');
 m.textContent=description.join('\n');
 if(r.suggestions?.length===4){
  card.append(eqGraph(data.baseline,r.suggestions));
  const bands=document.createElement('div');bands.style.cssText='font-size:12px;margin:5px 0;color:#bfe7d3;white-space:pre-line';
  bands.textContent=r.suggestions.map(x=>'B'+x.band+' '+x.type+' · '+Math.round(x.frequencyHz)+'Hz · '+x.gainDb+'dB · Q'+Number(x.q).toFixed(2)).join('\n');card.append(bands);
 }
 card.append(apply);apply.disabled=!r.reviewComplete||!!data.applied||!data.sourceConfirmed||!!run||applying;
 apply.onclick=()=>applyOne(ch,m,apply);
}
function stop(){
 if(!run)return;const r=run;run=null;r.controller.abort();
 if(measurement){measurement.reject(new DOMException('Stopped by operator','AbortError'));measurement=null}
 clearTimeout(r.timer);status('Stopped Listening. No computer EQ changed.');updateButtons();
}
async function check(){
 if(run||applying||!selected||!stream)return;
 if(!$('x32-pb-confirm').checked){status('Play audio from this computer and confirm its Dante meter follows this source before analysis.');return}
 let ch=selected;
 const controller=new AbortController();run={controller,ch,timer:null};updateButtons();
 try{
  if($('x32-playback-room').checked){if(!window.X32RoomInput)throw Error('Room mic monitor not available');await window.X32RoomInput.ensure()}
  if(controller.signal.aborted)throw new DOMException('Stopped','AbortError');
  const before=await bridge('/api/channel?number='+ch);
  if(!eqSame(before,before)||before.channel!==ch||typeof before.eqOn!=='boolean'||before.bands?.length!==4)throw Error('Fresh X32 EQ snapshot unavailable on CH'+ch);
  status('Listening to '+specs[ch].name+'. Capturing 12 seconds of usable program audio…');
  const pcm=await new Promise((resolve,reject)=>{
   const m={resolve,reject,samples:[],floor:-92,started:false,activeSec:0,peak:-120,phase:0,sum:0,count:0};
   measurement=m;
   run.timer=setTimeout(()=>{if(measurement===m){measurement=null;reject(Error('Could not capture sufficient computer audio within 75 seconds'))}},75000);
  });
  clearTimeout(run.timer);run.timer=null;
  if(controller.signal.aborted)throw new DOMException('Stopped','AbortError');
  const direct=wav(pcm);
  if(playUrl)URL.revokeObjectURL(playUrl);
  playUrl=URL.createObjectURL(new Blob([direct],{type:'audio/wav'}));$('x32-pb-play').disabled=false;
  let roomWav=null,useRoomMic=$('x32-playback-room').checked;
  if(useRoomMic)roomWav=window.X32RoomInput.snapshot();
  status('AI reviewing CH'+ch+' program audio'+(useRoomMic?' and room microphone':'')+'…');
  const response=await fetch('/api/ai/playback-eq',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
   body:JSON.stringify({channel:ch,sourceKind:'computer_playback',readback:before,wavBase64:to64(direct),useRoomMic,...(roomWav?{roomWavBase64:to64(roomWav)}:{})}),
   signal:controller.signal});
  const result=await response.json().catch(()=>({error:'AI response not valid JSON'}));
  if(!response.ok)throw Error(result.error||'AI analysis HTTP '+response.status);
  if(result.channel!==ch||result.sourceKind!=='computer_playback')throw Error('AI channel mismatch');
  reports.set(ch,{baseline:before,review:result,sourceConfirmed:true});
  renderCard(ch);status('CH'+ch+' computer EQ suggestions ready for review. '+(result.roomMicUsed?'Room context included.':'Room mic off.')+' No changes applied.');
 }catch(e){status(e.name==='AbortError'?'Listening stopped; mixer unchanged.':'Playback EQ unavailable: '+(e.message||e)+'. Mixer unchanged.')}
 finally{if(run?.controller===controller)run=null;measurement=null;updateButtons()}
}
async function applyOne(ch,msg,button){
 const data=reports.get(ch);if(run||applying||!data||!data.sourceConfirmed||!data.review?.reviewComplete)return;
 applying=true;updateButtons();button.disabled=true;
 try{
  const r=data.review;
  const baseline=data.baseline;
  if(r.channel!==ch||r.suggestions?.length!==4||new Set(r.suggestions.map(x=>x.band)).size!==4)throw Error('EQ review incomplete or wrong channel');
  const st=await bridge('/api/eq/status?channel='+ch);
  if(st.writesEnabled!==true||st.bridgeVersion!=='EQ-CHANNELS-01-32-V8')throw Error('Verified X32 bridge v8 required');
  const prep=await bridge('/api/eq/prepare?channel='+ch);
  if(!eqSame(baseline,prep.current))throw Error('CH'+ch+' EQ changed since the recording. Analyze again before applying.');
  const changes=r.suggestions.map(x=>({band:x.band,type:x.type,frequencyHz:x.frequencyHz,gainDb:x.gainDb,q:x.q}));
  const lines=changes.map(x=>'Band '+x.band+' '+Math.round(x.frequencyHz)+' Hz, '+x.gainDb+'dB, Q'+Number(x.q).toFixed(2));
  const confirm='APPLY THE FOUR PROPOSED EQ BANDS to X32 CH'+ch+' '+specs[ch].name+' (Input '+specs[ch].input+')?\n\n'+
   lines.join('\n')+'\n\nThis changes ONLY CH'+ch+'. You must audition through the PA. No verified post-EQ tap exists.';
  if(!window.confirm(confirm)){msg.textContent='EQ Apply cancelled; mixer unchanged.';return}
  msg.textContent='Applying CH'+ch+' only; waiting for real mixer EQ readback…';
  await bridge('/api/eq/apply','POST',{channel:ch,nonce:prep.nonce,recommendations:changes,speed:'instant',ack:'CONFIRM_REAL_X32_EQ_WRITE'});
  let verified=false;
  for(let i=0;i<45;i++){
   await new Promise(resolve=>setTimeout(resolve,1000));
   const checkState=await bridge('/api/eq/status?channel='+ch),j=checkState.job||{};
   if(j.channel!==ch)throw Error('Another mixer EQ operation became active');
   if(j.status==='verified'){verified=true;break}
   if(['stopped','failed'].includes(j.status))throw Error(j.error||'Mixer EQ write failed');
  }
  if(!verified)throw Error('EQ not independently verified within 45 seconds. Check local bridge before next write.');
  msg.textContent='CH'+ch+' EQ applied and verified by X32 readback. PA sound is not independently measured; listen and compare.';
  data.applied=true;data.review.reviewComplete=false;
 }catch(e){msg.textContent='Apply failed or not verified: '+e.message+' (inspect mixer/restore if needed)'}
 finally{applying=false;updateButtons();renderCard(ch)}
}
$('x32-pb-mac').onclick=()=>{const b=Array.from(document.querySelectorAll('#x32-channel-grid button.strip')).find(x=>Number(x.querySelector('.num')?.textContent)===26);if(b)b.click();else choose(26)};
$('x32-pb-pc').onclick=()=>{const b=Array.from(document.querySelectorAll('#x32-channel-grid button.strip')).find(x=>Number(x.querySelector('.num')?.textContent)===27);if(b)b.click();else choose(27)};
window.addEventListener('x32-channel-selected',e=>{const n=Number(e.detail?.channel);if(specs[n]){if(run)stop();choose(n)}else if(selected){stop();selected=0;seq++;closeDevice();updateButtons()}});
$('x32-pb-rescan').onclick=async()=>{try{if(!selected){status('Choose CH26 or CH27 first');return}let n=await scan();if(!n){const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());n=await scan()}status(n?'Choose the actual Dante receive device and lane for this computer.':'No Dante Virtual Soundcard device detected; verify Windows DVS and Chrome permissions.')}catch(e){status('Cannot list Dante devices: '+e.message)}};
$('x32-pb-device').onchange=()=>{deviceId=$('x32-pb-device').value;$('x32-pb-confirm').checked=false;storeSource();openDevice()};
$('x32-pb-lane').onchange=()=>{lane=Number($('x32-pb-lane').value);$('x32-pb-confirm').checked=false;storeSource();if(stream)status('Lane changed; play this computer and confirm the meter follows it.');};
$('x32-pb-confirm').onchange=storeSource;
$('x32-pb-check').onclick=check;$('x32-pb-stop').onclick=stop;
$('x32-pb-play').onclick=()=>{if(playUrl)new Audio(playUrl).play().catch(e=>status('Sample playback failed: '+e.message))};
window.addEventListener('beforeunload',()=>{stop();closeDevice();if(playUrl)URL.revokeObjectURL(playUrl)});
updateButtons();
})();