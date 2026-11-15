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
'<label style="display:block;margin:9px 0;color:#b9e0dd;font-size:13px"><input type="checkbox" id="x32-multi-room"> Use Room Mic <small style="display:block;color:#abc2cc;margin:4px 0 0 22px">Room mic CH28 / Input 15 · choose receive device and L/R lane below. Meter confirms incoming audio, not post-EQ routing.</small></label>'+
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
 $('x32-multi-room').disabled=!!job||applying;
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
 const obj={el,info,notes,apply,baseline:null,report:null,resultState:'pending'};cards.set(n,obj);return obj;
}

function eqOverlay(original,recommended,kind='compare'){
 const bands=original.bands.map(x=>({...x}));
 for(const s of recommended){const b=bands[s.band-1];if(b)Object.assign(b,{type:s.type,frequencyHz:s.frequencyHz,gainDb:s.gainDb,q:s.q});}
 const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
 const resp=(set,f)=>{
  let result=0;
  for(const b of set){
   const g=Number(b.gainDb)||0,c=clamp(Number(b.frequencyHz)||1000,20,20000),q=clamp(Number(b.q)||1,.3,10),z=Math.log2(f/c);
   if(b.type==='HCut')result+=-10*Math.log10(1+Math.pow(f/c,8));
   else if(b.type==='LCut')result+=-10*Math.log10(1+Math.pow(c/f,8));
   else if(b.type==='HShv')result+=g/(1+Math.exp(-5*z));
   else if(b.type==='LShv')result+=g/(1+Math.exp(5*z));
   else result+=g*Math.exp(-.5*Math.pow(z/(.7/q),2));
  }
  if(original.hpf?.on)result+=-10*Math.log10(1+Math.pow((Number(original.hpf.frequencyHz)||90)/f,8));
  return clamp(result,-20,20);
 };
 const curve=set=>Array.from({length:141},(_,i)=>{
  const f=40*Math.pow(18000/40,i/140),db=resp(set,f);
  return (i?'L':'M')+(38+i*3.8).toFixed(2)+','+(109-db*2.1).toFixed(2);
 }).join(' ');
 const d=document.createElement('div');d.style.cssText='margin:10px 0;padding:8px;border:1px solid #375866;border-radius:9px;background:#081c27';
 const leg=document.createElement('div');leg.style.cssText='display:flex;gap:14px;flex-wrap:wrap;font-size:11px;font-weight:700';
 const current=document.createElement('span');current.style.color='#ff7474';current.textContent='━━ Current EQ';
 if(kind!=='reference'){
  const proposed=document.createElement('span');proposed.style.color='#62ef9b';
  proposed.textContent=kind==='same'?'━━ AI target matches current EQ':'━━ Suggested EQ';
  leg.append(current,proposed);
 }else{
  current.textContent='━━ Current X32 EQ (not an AI result)';
  leg.append(current);
 }
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 590 153');svg.style.cssText='width:100%;height:auto;display:block';
 for(const [path,color,width] of (kind==='reference'?[[curve(original.bands),'#ff5555','4.5']]:[[curve(original.bands),'#ff5555','4.5'],[curve(bands),'#58ea90','2.8']])){
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d',path);p.setAttribute('fill','none');p.setAttribute('stroke',color);p.setAttribute('stroke-width',width);svg.appendChild(p);
 }
 const caption=document.createElement('div');caption.textContent=kind==='reference'?'Current X32 EQ settings only. The AI check FAILED or was inconclusive; this graph is NOT an approval.':kind==='same'?'The current and AI-suggested EQ curves overlap. No EQ changes recommended. Curves are modeled, not measured room audio.':'Calculated EQ response only; NOT measured post-EQ microphone or room sound.';
 caption.style.cssText='font-size:10px;color:#a9bdc7';
 d.append(leg,svg,caption);return d;
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
function eqGraphReady(e){
 return !!e&&Array.isArray(e.bands)&&e.bands.length===4&&
 e.bands.every(b=>['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(b?.type)&&
 Number.isFinite(b?.frequencyHz)&&Number.isFinite(b?.gainDb)&&Number.isFinite(b?.q));
}
function eqTargetChanged(original,suggestions){
 return suggestions.some(x=>{
  const b=original.bands[x.band-1];
  return !b||b.type!==x.type||
   Math.abs(b.frequencyHz-x.frequencyHz)>Math.max(3,b.frequencyHz*.018)||
   Math.abs(b.gainDb-x.gainDb)>.24||
   Math.abs(b.q-x.q)>.04;
 });
}
function finishIfDone(j){
 if(job!==j)return;
 if([...j.tracks.values()].every(t=>t.done)){
   destroyAudio(j);job=null;
   const states=j.channels.map(n=>cards.get(n)?.resultState||'failed');
   const failed=states.filter(x=>x==='failed').length;
   const incomplete=states.filter(x=>x==='incomplete').length;
   const noChanges=states.filter(x=>x==='nochanges').length;
   const changed=states.filter(x=>x==='changed').length;
   const partial=states.filter(x=>x==='partial').length;
   const message=failed||incomplete?
      'Analysis Failed or Incomplete on '+(failed+incomplete)+' microphone(s). No EQ verdict for those channels. See results below.':
      partial?'Direct Mic EQ Reviewed — Room audio review incomplete for '+partial+' channel(s); direct-mic results shown below.':
      noChanges===states.length?'EQ Check Complete — No Changes Recommended for the selected microphones.':
      'EQ Check Complete — '+changed+' channel(s) with suggestions, '+noChanges+' with no EQ changes recommended.';
   status(message);updateOptions();unifiedCompleted(j).catch(err=>status('Continuous analysis stopped: '+String(err.message||err)));
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
   body:JSON.stringify({channel:t.n,readback:c.baseline,wavBase64:toBase64(asWav(t.samples)),analysisMode:j.mode,useRoomMic:j.useRoom,...(j.useRoom?{roomWavBase64:toBase64(t.roomWav)}:{})}),
   signal:j.abort.signal
  });
  const data=await response.json().catch(()=>({error:'AI response was not JSON'}));
  if(job!==j)return;
  if(!response.ok)throw Error(data.error||'AI review HTTP '+response.status);
  c.report=data;
  const reliable=data.voiceDetected===true&&['medium','high'].includes(data.confidence)&&data.reviewComplete===true&&
    Array.isArray(data.suggestions)&&data.suggestions.length===4&&data.channel===t.n&&
    data.suggestions.every(x=>Number.isInteger(x.band)&&x.band>=1&&x.band<=4&&['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(x.type)&&Number.isFinite(x.frequencyHz)&&x.frequencyHz>=20&&x.frequencyHz<=20000&&Number.isFinite(x.gainDb)&&Math.abs(x.gainDb)<=15&&Number.isFinite(x.q)&&x.q>=.3&&x.q<=10);
  const changed=reliable&&eqTargetChanged(c.baseline,data.suggestions);
  const invalidRetry=data.eqRetryStatus==='failed';
  const partial=j.useRoom&&data.roomAnalysisStatus!=='complete';
  c.resultState=reliable?(partial?'partial':changed?'changed':'nochanges'):'incomplete';
  c.info.textContent=(invalidRetry?'Analysis Incomplete — AI returned no usable four-band EQ settings':reliable?(partial?'Direct Mic EQ Reviewed — Room Review Unavailable':changed?'EQ Check Complete — Suggested Changes Ready':'EQ Check Complete — No Changes Recommended'):
    data.voiceDetected===false?'Check Inconclusive — No clear vocal detected':'Analysis Incomplete — No reliable EQ verdict')+
    ' · '+String(data.confidence||'low')+' vocal confidence'+
    (data.roomMicUsed?' · room context received':' · room mic off');

  const lines=[data.summary||'No conclusion'];
  if(invalidRetry)lines.push('An automatic direct-microphone EQ retry was attempted. No valid target was produced. This is an AI processing failure, not a verified no-change outcome.');
  if(data.roomMicUsed&&data.roomAnalysisStatus!=='complete'){
   lines.push('Room audio was recorded but its audible review was incomplete. EQ suggestions are based only on DIRECT microphone audio.');
  }
  if(data.roomMicUsed&&data.roomAnalysisStatus==='complete'){
   lines.push('AI room findings: '+String(data.roomAssessment?.audibleRoomObservations||'Room observations unavailable'));
   lines.push('Room influence on EQ: '+String(data.roomAssessment?.impactOnEQ||'Not confirmed'));
   lines.push(j.mode==='singing'?"Room recording includes the full worship mix; EQ remains primarily singer-direct based.":"Room recording supplements direct-mic speech with ambient clarity context.");
   if(data.roomQuality)lines.push('Room: '+data.roomQuality.peakDbfs+' dBFS peak / '+data.roomQuality.rmsDbfs+' dBFS RMS.');
  }
  for(const o of data.audibleFindings||[])lines.push('• '+String(o).slice(0,180));
  if(reliable)for(const x of data.suggestions)lines.push('B'+x.band+' · '+Math.round(x.frequencyHz)+' Hz · '+x.gainDb+' dB · Q '+Number(x.q).toFixed(2));
  const dyn=data.dynamicsReview;
  if(dyn){
    const gate=dyn.gate||{},comp=dyn.compressor||{};
    const val=(x,suffix='')=>Number.isFinite(x)?Number(x).toFixed(1)+suffix:'—';
    const setting=(x)=>x===true?'ON':x===false?'OFF':'unknown';
    lines.push('GATE · '+setting(gate.current?.on)+' · threshold '+val(gate.current?.thresholdDb,' dB')+
      (gate.current?.mode?' · '+gate.current.mode:''));
    lines.push('AI GATE: '+(gate.assessment||'No definitive assessment')+
      (gate.reason?' · '+gate.reason:''));
    if(gate.suggested?.on!==null||gate.suggested?.thresholdDb!==null||gate.suggested?.rangeDb!==null)
      lines.push('SUGGESTED GATE · '+setting(gate.suggested?.on)+
        ' · threshold '+val(gate.suggested?.thresholdDb,' dB')+
        ' · range '+val(gate.suggested?.rangeDb,' dB')+
        (gate.suggested?.attackMs!==null?' · attack '+val(gate.suggested.attackMs,' ms'):'')+
        (gate.suggested?.holdMs!==null?' · hold '+val(gate.suggested.holdMs,' ms'):'')+
        (gate.suggested?.releaseMs!==null?' · release '+val(gate.suggested.releaseMs,' ms'):''));
    lines.push('COMPRESSOR · '+setting(comp.current?.on)+' · threshold '+val(comp.current?.thresholdDb,' dB')+
      ' · ratio '+val(comp.current?.ratio,':1'));
    lines.push('AI COMPRESSOR: '+(comp.assessment||'No definitive assessment')+
      (comp.reason?' · '+comp.reason:''));
    if(comp.suggested?.on!==null||comp.suggested?.thresholdDb!==null||comp.suggested?.ratio!==null)
      lines.push('SUGGESTED COMPRESSOR · '+setting(comp.suggested?.on)+
        ' · threshold '+val(comp.suggested?.thresholdDb,' dB')+
        ' · ratio '+val(comp.suggested?.ratio,':1')+
        (comp.suggested?.attackMs!==null?' · attack '+val(comp.suggested.attackMs,' ms'):'')+
        (comp.suggested?.releaseMs!==null?' · release '+val(comp.suggested.releaseMs,' ms'):'')+
        (comp.suggested?.makeupDb!==null?' · makeup '+val(comp.suggested.makeupDb,' dB'):''));
    lines.push('Dynamics: recommendations only. '+(dyn.readbackVerified?'Current settings read directly from X32.':'Some current settings may be missing or cached.')+
      ' No gate/compressor changes have been sent.');
  }
  c.notes.textContent=lines.join('\n');
  c.el.querySelector('.x32-multi-overlay')?.remove();
  if(eqGraphReady(c.baseline)){
   const canvas=eqOverlay(c.baseline,reliable?data.suggestions:[],reliable?(changed?'compare':'same'):'reference');
   canvas.className='x32-multi-overlay';c.notes.after(canvas);
  }
  if(reliable&&!changed)c.notes.textContent='AI check completed successfully. The suggested four-band EQ matches the existing settings within the mixer comparison tolerances. No EQ change is recommended.\n'+c.notes.textContent;
  c.apply.disabled=!reliable||!changed;
 }catch(e){
  if(job!==j)return;
  c.resultState='failed';c.report=null;c.apply.disabled=true;
  c.info.textContent='Analysis Failed — No EQ Verdict · X32 Unchanged';
  const message=e.name==='AbortError'?'Listening was stopped before the AI finished.':
    /Room mic was submitted/i.test(String(e.message))?
    'The room mic recording arrived, but the AI did not complete its room assessment. This is an error, NOT a no-change recommendation.':
    'The AI did not complete a valid EQ review. This is an error, NOT a no-change recommendation.';
  c.notes.textContent=message;
  const detail=document.createElement('details');detail.style.marginTop='8px';
  const title=document.createElement('summary');title.textContent='Technical error details';
  const raw=document.createElement('div');raw.textContent=String(e.message||e).slice(0,500);
  detail.append(title,raw);c.notes.after(detail);
  c.el.querySelector('.x32-multi-overlay')?.remove();
  if(eqGraphReady(c.baseline)){
   const graph=eqOverlay(c.baseline,[],'reference');
   graph.className='x32-multi-overlay';detail.after(graph);
  }
 }finally{
  t.done=true;t.samples=[];finishIfDone(j);
 }
}

function ingest(j,t,data,sr){
 if(t.done||t.captured||!data||!data.length)return;
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
   t.captured=true;
   if(j.useRoom){try{t.roomWav=window.X32RoomInput.snapshot()}catch(e){t.done=true;const c=card(t.n);c.info.textContent='Room Mic enabled but unavailable';c.notes.textContent=e.message+' · No EQ analysis sent for CH'+t.n;c.apply.disabled=true;finishIfDone(j);return;}}
   analyzeOne(j,t);
   if([...j.tracks.values()].every(other=>other.done||other.captured))destroyAudio(j);
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
 const j={id,abort,mode:$('x32-multi-mode').value,useRoom:$('x32-multi-room').checked,channels:[...selected].sort((a,b)=>a-b),
  ctx:null,streams:[],processors:[],tracks:new Map(),clock:null,timeout:null,audioClosed:false};
 job=j;cards.clear();$('x32-multi-results').replaceChildren();updateOptions();
 status('Opening verified DVS receive pairs; no mixer routing changes…');
 try{
  const selectedChannel=window.X32StageReadback?.();
  if(!selectedChannel?.connected)throw Error('Windows mixer bridge is not connected');
  if(j.useRoom){if(!window.X32RoomInput)throw Error('Room meter not initialized');await window.X32RoomInput.ensure();}
  const initial=await Promise.all(j.channels.map(async n=>{
   const rb=await bridge('/api/channel?number='+n+'&dynamics=1');
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
   if(job!==j){stream.getTracks().forEach(track=>track.stop());return;}
   j.streams.push(stream);
   const input=j.ctx.createMediaStreamSource(stream),processor=j.ctx.createScriptProcessor(4096,2,1),mute=j.ctx.createGain();
   mute.gain.value=0;input.connect(processor);processor.connect(mute);mute.connect(j.ctx.destination);
   j.processors.push({input,processor,mute});
   processor.onaudioprocess=e=>{
    if(job!==j||j.abort.signal.aborted)return;
    for(const info of initial.filter(x=>x.pair===pair)){
     if(e.inputBuffer.numberOfChannels<=info.lane){const t=j.tracks.get(info.n);if(t&&!t.done){t.done=true;card(info.n).inf --- TRUNCATED --- 33,446 chars