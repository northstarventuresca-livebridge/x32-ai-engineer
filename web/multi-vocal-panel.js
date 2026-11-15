/* X32 Multi-Vocal AI analysis — development only. Uses only verified DVS Rx mappings.
   This does not route Dante, change the X32, or claim a verified post-EQ tap. */
(()=>{
'use strict';
const mapped=[1,2,3,4,5,6,13,14,15,16],MAX=6,RATE=16000,COUNT=RATE*12;
const $=id=>document.getElementById(id);
const panel=document.createElement('section');
panel.id='x32-multi-panel';panel.className='card';
panel.style.cssText='margin:15px 0;background:#0b2331;border:1px solid #3a7180;border-radius:14px;padding:16px';
panel.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center"><h2 style="margin:0;font-size:19px">Multi-Vocal EQ Analysis</h2><span style="color:#b6d0d9;font-size:12px">Development preview · independent Dante inputs</span></div>'+
'<p style="color:#aac6d0;font-size:12px;margin:8px 0">Choose up to six verified Dante channels. All selected microphones are captured simultaneously, evaluated individually, and receive independent EQ suggestions. Audio tap position and post-EQ sound are NOT verified.</p>'+
'<div id="x32-multi-options" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:7px;margin:10px 0"></div>'+
'<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:9px 0"><label for="x32-multi-mode">Analysis:</label><select id="x32-multi-mode"><option value="speaking">Speaking</option><option value="singing">Singing</option></select><button id="x32-multi-go" type="button">Check EQ · Selected Channels</button><button id="x32-multi-stop" type="button" disabled style="border-color:#e48282;color:#ffd6d6">Stop Listening</button></div>'+
'<div id="x32-multi-state" role="status" style="font-size:12px;color:#b9e3d2">Nothing recording. Select microphones above.</div>'+
'<div id="x32-multi-results" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px"></div>'+
'<p style="font-size:11px;color:#afc3d2;margin-top:10px">A strong mic signal is only a candidate vocal, not proof of voice isolation. Instrument bleed or other vocalists may be present. AI must confirm a clear vocal before an Apply button can be enabled. Every Apply requires separate confirmation and a fresh verified mixer readback.</p>';
$('x32-quick')?.before(panel);
const selected=new Set(),cards=new Map();
let job=null,applying=false,sessionId=0;
const status=s=>{$('x32-multi-state').textContent=s};
const safeNum=x=>Number.isFinite(Number(x))?Number(x):null;
const channelName=n=>{
 const strip=Array.from(document.querySelectorAll('#x32-channel-grid button.strip')).find(b=>Number(b.querySelector('.num')?.textContent)===n);
 return strip?.querySelector('.chname')?.textContent?.trim()||'CH '+n;
};
const mappedPair=n=>{const rx=window.X32DanteRx?.(n);return rx?(rx%2?rx:rx-1):null};
const labelPair=(label,pair)=>{
 const m=label.match(/(?:Receive|Rx)\s*(\d+)\s*[-–]\s*(\d+)/i);
 return /DVS/i.test(label)&&m&&Number(m[1])===pair&&Number(m[2])===pair+1;
};
const bridgeKey=()=>String($('x32-key')?.value||'').trim();
async function bridge(path,method='GET',body){
 if(!bridgeKey())throw Error('Connect the Windows bridge and enter its key first');
 const response=await fetch('http://127.0.0.1:8792'+path,{method,
 headers:{'X-Bridge-Key':bridgeKey(),...(body?{'Content-Type':'application/json'}:{})},
 body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(16000)});
 const data=await response.json().catch(()=>({error:'Invalid local bridge response'}));
 if(!response.ok)throw Error(data.error||'Windows bridge HTTP '+response.status);
 return data;
}
function updateOptions(){
 const holder=$('x32-multi-options');holder.replaceChildren();
 for(const n of mapped){
  const b=document.createElement('button');b.type='button';
  b.disabled=!!job||applying;b.setAttribute('aria-pressed',selected.has(n)?'true':'false');
  b.style.cssText='text-align:left;padding:8px;border:1px solid '+(selected.has(n)?'#63dbb5':'#3d5966')+';border-radius:8px;background:'+(selected.has(n)?'#17483b':'#122b39')+';color:#e7f7f5';
  b.textContent=(selected.has(n)?'✓ ':'□ ')+'CH'+n+' · '+channelName(n);
  b.onclick=()=>{
   if(selected.has(n))selected.delete(n);
   else if(selected.size>=MAX){status('Select up to '+MAX+' channels per analysis run.');return;}
   else selected.add(n);
   updateOptions();
  };
  holder.appendChild(b);
 }
 $('x32-multi-go').disabled=!!job||applying||!selected.size;
 $('x32-multi-mode').disabled=!!job||applying;
 $('x32-multi-stop').disabled=!job;
}
function card(n){
 if(cards.has(n))return cards.get(n);
 const el=document.createElement('section');
 el.style.cssText='border:1px solid #365968;border-radius:11px;background:#102b38;padding:12px;min-width:0';
 const heading=document.createElement('strong'),info=document.createElement('div'),notes=document.createElement('div');
 heading.textContent='CH'+n+' · '+channelName(n);
 info.style.cssText='margin-top:7px;font-size:12px;color:#b6dce4';
 notes.style.cssText='margin-top:9px;font-size:12px;white-space:pre-line;line-height:1.5';
 const apply=document.createElement('button');apply.type='button';apply.disabled=true;
 apply.textContent='Apply EQ to CH'+n;apply.style.cssText='margin-top:10px;width:100%;background:#186344;color:#f0fff7';
 apply.onclick=()=>applyOne(n,apply,info);
 el.append(heading,info,notes,apply);
 $('x32-multi-results').appendChild(el);
 const obj={el,info,notes,apply,baseline:null,report:null};cards.set(n,obj);return obj;
}
function asWav(pcm){
 const buf=new ArrayBuffer(44+pcm.length*2),v=new DataView(buf),b=new Uint8Array(buf);
 const word=(p,str)=>{for(let i=0;i<str.length;i++)b[p+i]=str.charCodeAt(i)};
 word(0,'RIFF');v.setUint32(4,buf.byteLength-8,true);word(8,'WAVE');
 word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,RATE,true);v.setUint32(28,RATE*2,true);v.setUint16(32,2,true);
 v.setUint16(34,16,true);word(36,'data');v.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++)v.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),true);
 return b;
}
function toBase64(bytes){
 let s='';for(let i=0;i<bytes.length;i+=12000)s+=String.fromCharCode(...bytes.subarray(i,i+12000));
 return btoa(s);
}
function destroyAudio(j){
 if(j.audioClosed)return;
 j.audioClosed=true;
 clearInterval(j.clock);clearTimeout(j.timeout);
 for(const p of j.processors){p.processor.onaudioprocess=null;try{p.input.disconnect()}catch{}try{p.processor.disconnect()}catch{}try{p.mute.disconnect()}catch{}}
 for(const stream of j.streams)for(const track of stream.getTracks())track.stop();
 j.ctx?.close().catch(()=>{});
}
function finishIfDone(j){
 if(job!==j)return;
 if([...j.tracks.values()].every(t=>t.done)){
   destroyAudio(j);job=null;status('Analysis finished. Review each result and apply only the channels you approve.');updateOptions();
 }
}
function clearRecorder(t){t.samples=[];t.started=false;t.activeSec=0;t.maxPeak=-120;t.phase=0;t.sum=0;t.count=0;}
async function analyzeOne(j,t){
 const c=card(t.n);
 if(job!==j||j.abort.signal.aborted)return;
 c.info.textContent='12-second candidate vocal captured · AI reviewing independently…';
 try{
  const response=await fetch('/api/ai/voice-eq',{
   method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
   body:JSON.stringify({channel:t.n,readback:c.baseline,wavBase64:toBase64(asWav(t.samples)),analysisMode:j.mode}),
   signal:j.abort.signal
  });
  const data=await response.json().catch(()=>({error:'AI response was not JSON'}));
  if(job!==j)return;
  if(!response.ok)throw Error(data.error||'AI review HTTP '+response.status);
  c.report=data;
  const reliable=data.voiceDetected===true&&data.confidence!=='low'&&data.reviewComplete===true&&
    Array.isArray(data.suggestions)&&data.suggestions.length===4&&data.channel===t.n&&
    data.suggestions.every(x=>Number.isInteger(x.band)&&x.band>=1&&x.band<=4&&Number.isFinite(x.frequencyHz)&&Number.isFinite(x.gainDb)&&Number.isFinite(x.q));
  c.info.textContent=(reliable?'Voice sufficiently audible · ready for operator review':'Vocal not confidently isolated · no EQ apply')+
    ' · '+String(data.confidence||'low')+' confidence · PRE/POST-EQ TAP UNVERIFIED';
  const lines=[data.summary||'No conclusion'];
  for(const o of data.audibleFindings||[])lines.push('• '+String(o).slice(0,180));
  if(reliable)for(const x of data.suggestions)lines.push('B'+x.band+' · '+Math.round(x.frequencyHz)+' Hz · '+x.gainDb+' dB · Q '+Number(x.q).toFixed(2));
  c.notes.textContent=lines.join('\n');
  c.apply.disabled=!reliable;
 }catch(e){
  if(job!==j)return;
  c.info.textContent='AI analysis unavailable · EQ unchanged';
  c.notes.textContent=e.name==='AbortError'?'Analysis cancelled':String(e.message||e);
 }finally{
  t.done=true;t.samples=[];finishIfDone(j);
 }
}
function ingest(j,t,data,sr){
 if(t.done||!data||!data.length)return;
 let ss=0,pk=0;
 for(let i=0;i<data.length;i++){const x=data[i];ss+=x*x;pk=Math.max(pk,Math.abs(x))}
 const rms=20*Math.log10(Math.max(1e-8,Math.sqrt(ss/data.length)));
 const peak=20*Math.log10(Math.max(1e-8,pk));
 t.noise=Math.min(t.noise,rms);
 const active=rms>Math.max(-86,t.noise+8)&&peak>-78;
 if(!t.started){
  if(!active)return;
  t.started=true;t.activeSec=0;t.maxPeak=-120;t.samples=[];t.phase=0;t.sum=0;t.count=0;
 }
 if(active)t.activeSec+=data.length/sr;
 t.maxPeak=Math.max(t.maxPeak,peak);
 const step=sr/RATE;
 for(let i=0;i<data.length&&t.samples.length<COUNT;i++){
  const v=data[i];t.sum+=Number.isFinite(v)?v:0;t.count++;t.phase++;
  if(t.phase>=step){
   t.samples.push(t.sum/t.count);t.phase-=step;t.sum=0;t.count=0;
  }
 }
 const c=card(t.n);
 if(t.samples.length%RATE<240)c.info.textContent='Listening · '+Math.floor(t.samples.length/RATE)+'/12 sec · live vocal activity '+t.activeSec.toFixed(1)+' sec';
 if(t.samples.length>=COUNT){
  if(t.activeSec>=3.5&&t.maxPeak>-76){
   t.done=true;
   analyzeOne(j,t);
  }else{
   t.tries++;clearRecorder(t);
   c.info.textContent='Mic may contain silence or bleed. Waiting for stronger vocal activity · retry '+t.tries;
  }
 }
}
async function start(){
 if(job||applying||!selected.size)return;
 if(!window.isSecureContext){status('Microphone access requires HTTPS.');return;}
 if(!bridgeKey()){status('Connect the Windows mixer bridge first.');return;}
 const id=++sessionId,abort=new AbortController();
 const j={id,abort,mode:$('x32-multi-mode').value,channels:[...selected].sort((a,b)=>a-b),
  ctx:null,streams:[],processors:[],tracks:new Map(),clock:null,timeout:null,audioClosed:false};
 job=j;cards.clear();$('x32-multi-results').replaceChildren();updateOptions();
 status('Opening verified DVS receive pairs; no mixer routing changes…');
 try{
  const selectedChannel=window.X32StageReadback?.();
  if(!selectedChannel?.connected)throw Error('Windows mixer bridge is not connected');
  const initial=await Promise.all(j.channels.map(async n=>{
   const rb=await bridge('/api/channel?number='+n);
   if(rb?.channel!==n||!Array.isArray(rb.bands)||rb.bands.length!==4)throw Error('CH'+n+' EQ readback unavailable');
   card(n).baseline=rb;return{n,rx:window.X32DanteRx(n),lane:window.X32DanteLane(n),pair:mappedPair(n)};
  }));
  if(job!==j)return;
  const stopOld=$('x32-listen-stop');if(stopOld&&!stopOld.disabled)stopOld.click();
  let sources=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  if(!sources.some(d=>/DVS.{0,40}(?:Receive|Rx)/i.test(d.label))){
   const permission=await navigator.mediaDevices.getUserMedia({audio:true});
   permission.getTracks().forEach(t=>t.stop());
   sources=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  }
  j.ctx=new AudioContext();
  const unique=[...new Set(initial.map(x=>x.pair))];
  for(const pair of unique){
   if(job!==j)return;
   const dev=sources.find(d=>labelPair(d.label,pair));
   if(!dev)throw Error('DVS Receive '+pair+'-'+(pair+1)+' missing. Verify Windows Dante input mapping.');
   const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:dev.deviceId},channelCount:2,autoGainControl:false,echoCancellation:false,noiseSuppression:false}});
   j.streams.push(stream);
   const input=j.ctx.createMediaStreamSource(stream),processor=j.ctx.createScriptProcessor(4096,2,1),mute=j.ctx.createGain();
   mute.gain.value=0;input.connect(processor);processor.connect(mute);mute.connect(j.ctx.destination);
   j.processors.push({input,processor,mute});
   processor.onaudioprocess=e=>{
    if(job!==j||j.abort.signal.aborted)return;
    for(const info of initial.filter(x=>x.pair===pair)){
     if(e.inputBuffer.numberOfChannels<=info.lane){const t=j.tracks.get(info.n);if(t&&!t.done){t.done=true;card(info.n).info.textContent='Stereo channel not present in DVS device';finishIfDone(j)}continue}
     ingest(j,j.tracks.get(info.n),e.inputBuffer.getChannelData(info.lane),j.ctx.sampleRate);
    }
   };
  }
  for(const info of initial)j.tracks.set(info.n,{n:info.n,done:false,samples:[],noise:-92,started:false,tries:0,activeSec:0,maxPeak:-120,phase:0,sum:0,count:0});
  await j.ctx.resume();
  if(job!==j)return;
  status('Listening to '+j.channels.length+' separate Dante microphones simultaneously · '+j.mode+'. Waiting for clear vocal samples…');
  j.clock=setInterval(()=>{
   if(job!==j)return;
   const running=[...j.tracks.values()].filter(t=>!t.done);
   if(running.length)status('Listening · '+running.length+' microphone(s) still gathering clear samples; analyzed channels appear below as they finish.');
  },3000);
  j.timeout=setTimeout(()=>{
   if(job!==j)return;
   for(const t of j.tracks.values())if(!t.done){
    t.done=true;t.samples=[];const c=card(t.n);
    c.info.textContent='No sufficiently strong microphone sample in 75 seconds';
    c.notes.textContent='Not analyzed; microphone quiet or vocal not confidently above noise/bleed. No changes proposed.';
    c.apply.disabled=true;
   }
   finishIfDone(j);
  },75000);
 }catch(e){
  if(job!==j)return;
  status('Multi-channel capture unavailable: '+String(e.message||e));
  for(const t of j.tracks.values())t.done=true;
  destroyAudio(j);job=null;updateOptions();
 }
}
function stop(){
 if(!job)return;
 const j=job;job=null;sessionId++;j.abort.abort();destroyAudio(j);
 for(const t of j.tracks.values())if(!t.done)card(t.n).info.textContent='Stopped by operator · no new EQ suggestion';
 status('Stopped listening to all selected channels. No mixer changes.');
 updateOptions();
}
function sameEq(a,b){
 if(!a||!b||!Array.isArray(a.bands)||!Array.isArray(b.bands)||a.bands.length!==4||b.bands.length!==4)return false;
 if(a.eqOn!==b.eqOn||a.hpf?.on!==b.hpf?.on)return false;
 if(a.hpf?.on&&Math.abs(a.hpf.frequencyHz-b.hpf.frequencyHz)>Math.max(2,a.hpf.frequencyHz*.015))return false;
 return a.bands.every((x,i)=>{
  const y=b.bands[i];return x.type===y.type&&
   Math.abs(x.frequencyHz-y.frequencyHz)<=Math.max(3,x.frequencyHz*.018)&&
   Math.abs(x.gainDb-y.gainDb)<=.24&&Math.abs(x.q-y.q)<=.04;
 });
}
async function applyOne(n,button,info){
 if(job||applying)return;
 const c=cards.get(n),r=c?.report;
 if(!r?.reviewComplete||!r.voiceDetected||r.confidence==='low'||r.channel!==n||!sameEq(c.baseline,c.baseline)){
  info.textContent='No eligible verified voice recommendation for this channel';return;
 }
 applying=true;updateOptions();button.disabled=true;
 try{
  const st=await bridge('/api/eq/status?channel='+n);
  if(st.writesEnabled!==true||st.bridgeVersion!=='EQ-CHANNELS-01-32-V8')throw Error('Verified Windows X32 bridge v8 required');
  const prepared=await bridge('/api/eq/prepare?channel='+n);
  if(!sameEq(c.baseline,prepared.current))throw Error('CH'+n+' EQ has changed since listening. Re-analyze before applying.');
  const suggestions=r.suggestions;
  if(suggestions.length!==4||new Set(suggestions.map(x=>x.band)).size!==4)throw Error('Complete four-band voice review required');
  const changes=suggestions.map(x=>({band:x.band,type:x.type,frequencyHz:x.frequencyHz,gainDb:x.gainDb,q:x.q}));
  const confirmText='APPLY THE FOUR SUGGESTED EQ BANDS TO PHYSICAL X32 CH'+n+' ('+channelName(n)+')?\n\n'+
   changes.map(x=>'Band '+x.band+': '+Math.round(x.frequencyHz)+' Hz / '+x.gainDb+' dB / Q '+Number(x.q).toFixed(2)).join('\n')+
   '\n\nChanges affect ONLY CH'+n+'. A channel-specific original backup is retained. This is not a verified post-EQ audio analysis.';
  if(!window.confirm(confirmText)){info.textContent='Operator cancelled. Mixer unchanged.';return;}
  info.textContent='Applying EQ only to CH'+n+'; waiting for verified X32 readback…';
  await bridge('/api/eq/apply','POST',{channel:n,nonce:prepared.nonce,recommendations:changes,speed:'instant',ack:'CONFIRM_REAL_X32_EQ_WRITE'});
  let complete=false;
  for(let attempt=0;attempt<45;attempt++){
   await new Promise(resolve=>setTimeout(resolve,1000));
   const check=await bridge('/api/eq/status?channel='+n);
   const j=check.job||{};
   if(j.channel!==n)throw Error('A different X32 EQ operation became active');
   if(j.status==='verified'){
    const verified=j.verified;
    if(!verified?.bands?.length)throw Error('Verified mixer readback missing');
    info.textContent='CH'+n+' EQ applied and VERIFIED by mixer readback. Audio post-EQ tap remains unverified.';
    complete=true;break;
   }
   if(['failed','stopped'].includes(j.status))throw Error(j.error||'Mixer did not verify this EQ write. Restore may be available.');
  }
  if(!complete)throw Error('EQ operation not verified within 45 seconds. Check local bridge before further writes.');
 }catch(e){info.textContent='Apply unavailable: '+String(e.message||e);}
 finally{applying=false;updateOptions();}
}
$('x32-multi-go').onclick=start;
$('x32-multi-stop').onclick=stop;
window.addEventListener('beforeunload',stop);
updateOptions();
})();
