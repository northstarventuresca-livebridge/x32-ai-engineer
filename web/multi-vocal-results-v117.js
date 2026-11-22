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
 const chooser=document.createElement('div');chooser.className='x32-eq-apply-choice';chooser.hidden=true;
 chooser.style.cssText='padding:10px;margin:9px 0;border:1px solid #436e70;border-radius:9px;background:#0c2c38';
 const createBtn=(name,color)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.style.cssText='display:inline-block;margin:3px;min-width:125px;min-height:42px;padding:9px;border-radius:7px;background:'+color;return b};
 const fast=createBtn('Fast Apply EQ','#176a49'),gradual=createBtn('Gradual Apply EQ','#255a70'),cancel=createBtn('Cancel','#354957'),halt=createBtn('Stop Applying','#734047');
 halt.hidden=true;chooser.append(fast,gradual,cancel,halt);
 apply.setAttribute('aria-expanded','false');
 apply.onclick=()=>{if(apply.disabled||applying||job)return;chooser.hidden=!chooser.hidden;apply.setAttribute('aria-expanded',String(!chooser.hidden))};
 fast.onclick=()=>applyOne(n,apply,info,'instant');
 gradual.onclick=()=>applyOne(n,apply,info,'slow');
 cancel.onclick=()=>{if(applying)return;chooser.hidden=true;apply.setAttribute('aria-expanded','false')};
 halt.onclick=async()=>{if(!applying||halt.disabled)return;halt.disabled=true;info.textContent='Requesting EQ stop…';try{await bridge('/api/eq/stop','POST',{});info.textContent='Stop requested. Some bands may have changed. Review/Restore before retrying.'}catch(err){info.textContent='Could not confirm Stop: '+String(err.message||err)}};
 el.append(heading,info,notes,apply,chooser);
 $('x32-multi-results').appendChild(el);
 const obj={el,info,notes,apply,chooser,fastApply:fast,gradualApply:gradual,cancelApply:cancel,stopApply:halt,eqApplied:false,baseline:null,report:null,resultState:'pending'};cards.set(n,obj);return obj;
}

/* V116 operator comparison: numbers, EQ curves, and dynamics in one result. */
function x32CompareResults(c,data,reliable){
 c.el.querySelector('.x32-audio-compare')?.remove();
 const make=(tag,cls,txt)=>{
  const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;
 };
 const fmt=(x,unit='',digits=1)=>Number.isFinite(x)?Number(x).toFixed(digits)+unit:'—';
 const yn=x=>x===true?'ON':x===false?'OFF':'—';
 const hz=x=>Number.isFinite(x)?Math.round(x)+' Hz':'—';
 const box=make('div','x32-audio-compare');
 const eq=make('section','x32-compare-section');
 eq.append(make('h4','','EQ · Before vs Suggested'));
 eq.append(make('p','x32-compare-help',reliable?'Numbers and modeled curves compare current X32 settings (red) with AI suggestions (green).':'Analysis incomplete. Showing only current mixer EQ; no AI suggestion available.'));
 const table=make('table','x32-compare-table'),head=make('thead'),header=make('tr');
 ['Band','Current on X32','AI Suggestion','What changes'].forEach(t=>header.append(make('th','',t)));
 head.append(header);table.append(head);
 const body=make('tbody');
 if(Array.isArray(c.baseline?.bands))for(let i=0;i<c.baseline.bands.length;i++){
  const old=c.baseline.bands[i],next=reliable?data.suggestions?.find(s=>s.band===i+1):null;
  const values=b=>(b?.type||'?')+' · '+hz(b?.frequencyHz)+' · '+fmt(b?.gainDb,' dB')+' · Q '+fmt(b?.q,'',2);
  const change=[];
  if(next){
   if(old.type!==next.type)change.push('Type: '+next.type);
   if(Math.abs(old.frequencyHz-next.frequencyHz)>Math.max(3,old.frequencyHz*.018))change.push('Freq: '+hz(next.frequencyHz-old.frequencyHz));
   if(Math.abs(old.gainDb-next.gainDb)>.24)change.push('Gain: '+(next.gainDb>old.gainDb?'+':'')+fmt(next.gainDb-old.gainDb,' dB'));
   if(Math.abs(old.q-next.q)>.04)change.push('Q: '+fmt(next.q-old.q,'',2));
  }
  const tr=make('tr');
  tr.append(make('td','','B'+(i+1)),make('td','x32-current',values(old)),make('td',next?'x32-suggested':'',next?values(next):'No target available'),make('td',change.length?'x32-changed':'',next?(change.join(' · ')||'No change'):'Not assessed'));
  body.append(tr);
 }
 table.append(body);eq.append(table);box.append(eq);
 const dynamics=make('section','x32-dyn-comparisons');
 dynamics.append(make('h4','','Gate & Compressor · Before vs Suggested'));
 dynamics.append(make('p','x32-compare-help','Recommendations only: Apply EQ does NOT change gate or compressor. An em dash (—) means no supported numeric adjustment was provided; it does not prove the current value is optimal.'));
 const d=data?.dynamicsReview;
 const draw=(label,current,review,kind)=>{
  const card=make('div','x32-dyn-card');
  card.append(make('h5','',label));
  const hasReview=typeof review?.assessment==='string'&&review.assessment.trim().length>8;
  card.append(make('p','x32-dyn-summary',hasReview?review.assessment:'AI dynamics audio review unavailable for this microphone.'));
  const fields=kind==='gate'?[
   ['Enabled','on','on','',null],['Threshold','thresholdDb','thresholdDb',' dB',[-80,0]],
   ['Range','rangeDb','rangeDb',' dB',null],['Attack','attackMs','attackMs',' ms',null],
   ['Hold','holdMs','holdMs',' ms',null],['Release','releaseMs','releaseMs',' ms',null]
  ]:[
   ['Enabled','on','on','',null],['Threshold','thresholdDb','thresholdDb',' dB',[-60,0]],
   ['Ratio','ratio','ratio',':1',null],['Attack','attackMs','attackMs',' ms',null],
   ['Release','releaseMs','releaseMs',' ms',null],['Makeup','makeupDb','makeupDb',' dB',null]
  ];
  const tab=make('table','x32-compare-table'),th=make('thead'),tr=make('tr');
  ['Setting','Current on X32','AI Suggestion'].forEach(t=>tr.append(make('th','',t)));
  th.append(tr);tab.append(th);const tb=make('tbody');
  const suggested=review?.suggested||{};
  for(const [title,k,sk,unit,scale] of fields){
   const orig=current?.[k],next=suggested[sk];
   const r=make('tr');
   const before=k==='on'?yn(orig):fmt(orig,unit);
   const after=next===null||next===undefined?'—':sk==='on'?yn(next):fmt(next,unit);
   r.append(make('td','',title),make('td','x32-current',before),make('td',next==null?'':'x32-suggested',after));
   tb.append(r);
   if(scale&&Number.isFinite(orig)){
    const plotRow=make('tr','x32-visual-row'),plotCell=make('td');
    plotCell.colSpan=3;
    const track=make('div','x32-threshold-track'),pct=x=>Math.max(0,Math.min(100,(x-scale[0])/(scale[1]-scale[0])*100));
    const cur=make('span','x32-threshold-now');cur.style.left=pct(orig)+'%';cur.title='Current '+fmt(orig,' dB');track.append(cur);
    if(Number.isFinite(next)){const sug=make('span','x32-threshold-ai');sug.style.left=pct(next)+'%';sug.title='AI proposed '+fmt(next,' dB');track.append(sug);}
    plotCell.append(track);plotRow.append(plotCell);tb.append(plotRow);
   }
  }
  tab.append(tb);card.append(tab);
  if(typeof review?.reason==='string'&&review.reason.trim())card.append(make('p','x32-dyn-reason',review.reason));
  return card;
 };
 dynamics.append(draw('Gate',Object.assign({},c.baseline?.gate||{},d?.gate?.current||{}),d?.gate,'gate'));
 dynamics.append(draw('Compressor',Object.assign({},c.baseline?.compressor||{},d?.compressor?.current||{}),d?.compressor,'compressor'));
 if(d?.limitations)dynamics.append(make('p','x32-compare-help',d.limitations));
 box.append(dynamics);c.notes.after(box);
 const overlay=c.el.querySelector('.x32-multi-overlay');
 if(overlay)eq.after(overlay);
}
(function(){
 if(document.getElementById('x32-compare-css'))return;
 const s=document.createElement('style');s.id='x32-compare-css';
 s.textContent=[
 '.x32-audio-compare{margin:12px 0 7px}',
 '.x32-compare-section,.x32-dyn-comparisons{margin:12px 0;padding:10px;border:1px solid #33586b;border-radius:10px;background:#0a2532;min-width:0}',
 '.x32-compare-section h4,.x32-dyn-comparisons h4{font-size:14px;margin:1px 0 7px;color:#e9f8f7}',
 '.x32-compare-help{font-size:11px;line-height:1.5;color:#abc7d0;margin:5px 0 10px}',
 '.x32-compare-table{width:100%;border-collapse:collapse;font-size:11px;line-height:1.5}',
 '.x32-compare-table th{font-weight:700;color:#aac8d0;text-align:left;border-bottom:1px solid #3b6977;padding:7px 6px}',
 '.x32-compare-table td{border-bottom:1px solid #1e4555;padding:7px 6px;vertical-align:top;overflow-wrap:anywhere}',
 '.x32-compare-table .x32-current{color:#ff9999;font-weight:650}',
 '.x32-compare-table .x32-suggested{color:#75efb8;font-weight:650}',
 '.x32-compare-table .x32-changed{color:#ffd28b}',
 '.x32-dyn-card{border:1px solid #355766;background:#0c2b37;border-radius:9px;padding:10px;margin:9px 0}',
 '.x32-dyn-card h5{font-size:14px;margin:0 0 7px}',
 '.x32-dyn-summary{font-size:12px;color:#d6e6ec;margin:0 0 10px;line-height:1.4}',
 '.x32-dyn-reason{font-size:11px;color:#b7d1d7;margin:9px 2px 0}',
 '.x32-visual-row td{padding:0 8px 7px!important}',
 '.x32-threshold-track{height:7px;position:relative;background:linear-gradient(90deg,#203e4c,#3c6671);border-radius:8px;margin:7px 5px 5px}',
 '.x32-threshold-now,.x32-threshold-ai{position:absolute;top:-3px;width:4px;height:13px;border-radius:3px;transform:translateX(-50%)}',
 '.x32-threshold-now{background:#ff7979;box-shadow:0 0 0 1px #572c33}',
 '.x32-threshold-ai{background:#62efad;box-shadow:0 0 0 1px #1d634e;top:0;width:5px;height:9px}',
 '@media(max-width:520px){.x32-compare-table{font-size:10px}.x32-compare-table td,.x32-compare-table th{padding:5px 3px}}'
 ].join('\n');
 document.head.append(s);
})();

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

  c.notes.textContent=lines.join('\n');
  c.el.querySelector('.x32-multi-overlay')?.remove();
  if(eqGraphReady(c.baseline)){
   const canvas=eqOverlay(c.baseline,reliable?data.suggestions:[],reliable?(changed?'compare':'same'):'reference');
   canvas.className='x32-multi-overlay';c.notes.after(canvas);
  }
  if(reliable&&!changed)c.notes.textContent='AI check completed successfully. The suggested four-band EQ matches the existing settings within the mixer comparison tolerances. No EQ change is recommended.\n'+c.notes.textContent;
  x32CompareResults(c,data,reliable);
  c.apply.disabled=!reliable||!changed||c.baseline?.eqReadbackFresh===false;
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
  x32CompareResults(c,{},false);
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
   if(rb?.channel!==n)throw Error('CH'+n+' channel metadata unavailable');
   let baseline=rb;
   try{
     const fresh=await bridge('/api/eq/prepare?channel='+n);
     const current=fresh?.current;
     if(current?.channel!==n||!Array.isArray(current.bands)||current.bands.length!==4||
       current.bands.some(x=>!Number.isFinite(x.frequencyHz)||!Number.isFinite(x.gainDb)||!Number.isFinite(x.q)||typeof x.type!=='string'))
       throw Error('fresh X32 EQ readback incomplete');
     baseline={...rb,...current,eqOn:true,gate:rb.gate,compressor:rb.compressor};
   }catch(err){
     // Allow an advisory when fresh reads are not available, but never allow
     // the Apply button to imply a stale or unverified EQ baseline is safe.
     baseline={...rb,eqReadbackFresh:false};
     card(n).info.textContent='CH'+n+' fresh X32 EQ unavailable: '+String(err.message||err)+'. Apply will be blocked until verified.';
   }
   baseline.eqReadbackFresh=baseline.eqReadbackFresh!==false;
   card(n).baseline=baseline;
   return{n,rx:window.X32DanteRx(n),lane:window.X32DanteLane(n),pair:mappedPair(n)};
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
     if(e.inputBuffer.numberOfChannels<=info.lane){const t=j.tracks.get(info.n);if(t&&!t.done){t.done=true;card(info.n).info.textContent='Stereo channel not present in DVS device';finishIfDone(j)}continue}
     ingest(j,j.tracks.get(info.n),e.inputBuffer.getChannelData(info.lane),j.ctx.sampleRate);
    }
   };
  }
  for(const info of initial)j.tracks.set(info.n,{n:info.n,done:false,captured:false,samples:[],noise:-92,started:false,tries:0,activeSec:0,maxPeak:-120,phase:0,sum:0,count:0});
  await j.ctx.resume();
  if(job!==j)return;
  status('Listening to '+j.channels.length+' independent Dante microphones · '+j.mode+(j.useRoom?' · optional room full-mix context ON':' · room mic OFF')+'. Waiting for clear vocal samples…');
  j.clock=setInterval(()=>{
   if(job!==j)return;
   const running=[...j.tracks.values()].filter(t=>!t.done&&!t.captured);
   if(running.length)status('Listening · '+running.length+' microphone(s) still gathering clear samples; analyzed channels appear below as they finish.');
  },3000);
  j.timeout=setTimeout(()=>{
   if(job!==j)return;
   for(const t of j.tracks.values())if(!t.done&&!t.captured){
    t.done=true;t.captured=true;t.samples=[];const c=card(t.n);
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
 if(a.hpf?.on!==b.hpf?.on)return false;
 if(a.hpf?.on&&Math.abs(a.hpf.frequencyHz-b.hpf.frequencyHz)>Math.max(2,a.hpf.frequencyHz*.015))return false;
 return a.bands.every((x,i)=>{
  const y=b.bands[i];return x.type===y.type&&
   Math.abs(x.frequencyHz-y.frequencyHz)<=Math.max(3,x.frequencyHz*.018)&&
   Math.abs(x.gainDb-y.gainDb)<=.24&&Math.abs(x.q-y.q)<=.04;
 });
}
async function applyOne(n,button,info,speed){
 if(job||applying||!['instant','slow'].includes(speed))return;
 const c=cards.get(n),r=c?.report;
 if(c?.eqApplied){info.textContent='Already applied to CH'+n+'. Run Check EQ again before applying further changes.';return;}
 if(c?.baseline?.eqReadbackFresh===false){info.textContent='Cannot apply: X32 EQ baseline was not freshly verified. Run Check EQ when the mixer responds.';return;}
 if(!r?.reviewComplete||!r.voiceDetected||r.confidence==='low'||r.channel!==n||!Array.isArray(r.suggestions)||r.suggestions.length!==4){
  info.textContent='No eligible verified voice recommendation for this channel';return;
 }
 applying=true;updateOptions();button.disabled=true;
 c.fastApply.disabled=true;c.gradualApply.disabled=true;c.cancelApply.disabled=true;c.stopApply.hidden=false;c.stopApply.disabled=false;
 try{
  const st=await bridge('/api/eq/status?channel='+n);
  if(st.writesEnabled!==true||!['EQ-CHANNELS-01-32-V8','AUTO-ROOM-POST-EQ-V109'].includes(st.bridgeVersion))throw Error('Verified Windows X32 bridge v8 required');
  const prepared=await bridge('/api/eq/prepare?channel='+n);
  if(!sameEq(c.baseline,prepared.current))throw Error('CH'+n+' EQ has changed since listening. Re-analyze before applying.');
  const suggestions=r.suggestions;
  if(suggestions.length!==4||new Set(suggestions.map(x=>x.band)).size!==4)throw Error('Complete four-band voice review required');
  const changes=suggestions.map(x=>({band:x.band,type:x.type,frequencyHz:x.frequencyHz,gainDb:x.gainDb,q:x.q}));
  const confirmText='APPLY THE FOUR SUGGESTED EQ BANDS TO PHYSICAL X32 CH'+n+' ('+channelName(n)+')?\n\n'+
   changes.map(x=>'Band '+x.band+': '+Math.round(x.frequencyHz)+' Hz / '+x.gainDb+' dB / Q '+Number(x.q).toFixed(2)).join('\n')+
   '\n\nChanges affect ONLY CH'+n+'. A channel-specific original backup is retained. This is not a verified post-EQ audio analysis.';
  if(!window.confirm((speed==='slow'?'GRADUAL':'FAST')+' EQ APPLY\n\n'+confirmText+'\n\n'+(speed==='slow'?'Gains ramp in verified steps. Filter type, frequency and Q update individually.':'Bands update as quickly as the X32 can verify them.')+'\n\nGate and compressor are NOT changed.')){info.textContent='Cancelled. Mixer unchanged.';return;}
  info.textContent=(speed==='slow'?'Gradually applying':'Quickly applying')+' EQ to CH'+n+' · verifying X32…';
  await bridge('/api/eq/apply','POST',{channel:n,nonce:prepared.nonce,recommendations:changes,speed,ack:'CONFIRM_REAL_X32_EQ_WRITE'});
  let complete=false;
  for(let attempt=0;attempt<(speed==='slow'?200:95);attempt++){
   await new Promise(resolve=>setTimeout(resolve,1000));
   const check=await bridge('/api/eq/status?channel='+n);
   const j=check.job||{};
   if(j.channel!==n)throw Error('A different X32 EQ operation became active');
   if(j.status==='verified'){
    const verified=j.verified;
    if(!verified?.bands?.length)throw Error('Verified mixer readback missing');
    c.eqApplied=true;
    info.textContent='✓ '+(speed==='slow'?'Gradual':'Fast')+' EQ applied and VERIFIED by mixer on CH'+n+'. Run Check EQ again to review.';
    complete=true;break;
   }
   if(['failed','stopped'].includes(j.status))throw Error(j.error||'Mixer did not verify this EQ write. Restore may be available.');
   info.textContent=(speed==='slow'?'Gradual':'Fast')+' EQ CH'+n+' · '+Math.min(4,Math.floor((j.step||0)/4))+'/4 bands · '+(j.status||'working')+'…';
  }
  if(!complete)throw Error('EQ not verified before timeout. Check local bridge before further writes.');
 }catch(e){info.textContent='Apply unavailable: '+String(e.message||e);}
 finally{
  applying=false;c.stopApply.hidden=true;c.stopApply.disabled=false;
  c.fastApply.disabled=false;c.gradualApply.disabled=false;c.cancelApply.disabled=false;
  c.chooser.hidden=true;c.apply.setAttribute('aria-expanded','false');
  if(c.eqApplied){button.disabled=true;button.textContent='Applied to CH'+n+' · Run Check EQ again';}
  else if(c?.report?.reviewComplete&&c.report.voiceDetected&&c.report.confidence!=='low')button.disabled=false;
  updateOptions();
 }
}
/* V110: unified interface controller, inside the existing multi-vocal engine closure. */
let unifiedMode='idle',unifiedTimer=null,unifiedGeneration=0,unifiedWrites=new Map(),unifiedLastWrite=new Map();
const unifiedPause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function unifiedSchedule(g){
  if(g!==unifiedGeneration||!['live','auto'].includes(unifiedMode))return;
  clearTimeout(unifiedTimer);
  unifiedTimer=setTimeout(()=>{
    if(g!==unifiedGeneration||!['live','auto'].includes(unifiedMode))return;
    if(!job&&!applying)start();else unifiedSchedule(g);
  },35000);
}
async function unifiedAutoPass(channels,g){
  if(g!==unifiedGeneration||unifiedMode!=='auto')return;
  applying=true;updateOptions();
  try{
    for(const n of channels){
      if(g!==unifiedGeneration||unifiedMode!=='auto')return;
      if((unifiedWrites.get(n)||0)>=2||Date.now()-(unifiedLastWrite.get(n)||0)<90000)continue;
      const c=cards.get(n),r=c?.report;
      if((r?.roomMicUsed===true&&r?.roomAnalysisStatus!=='complete')||!c?.baseline||r?.voiceDetected!==true||r?.confidence!=='high'||r?.reviewComplete!==true||r?.channel!==n||!Array.isArray(r.suggestions))continue;
      const candidate=r.suggestions.map(x=>{
        const old=c.baseline.bands[x?.band-1];
        if(!old||x.type!=='PEQ'||old.type!=='PEQ'||old.q>2.5||old.gainDb<=-9||
          !Number.isFinite(x.frequencyHz)||!Number.isFinite(x.gainDb)||!Number.isFinite(x.q)||
          Math.abs(Math.log2(x.frequencyHz/old.frequencyHz))>.14||
          Math.abs(x.q-old.q)>.22||x.gainDb>old.gainDb-.7)return null;
        return {band:x.band,type:old.type,frequencyHz:old.frequencyHz,
          gainDb:Math.max(-9,Math.round((old.gainDb-.5)*10)/10),q:old.q};
      }).find(Boolean);
      if(!candidate)continue;
      try{
        const st=await bridge('/api/eq/status?channel='+n);
        if(st.writesEnabled!==true||!['EQ-CHANNELS-01-32-V8','AUTO-ROOM-POST-EQ-V109'].includes(st.bridgeVersion))
          throw Error('Updated verified Windows EQ bridge required');
        const prep=await bridge('/api/eq/prepare?channel='+n);
        if(g!==unifiedGeneration||unifiedMode!=='auto')return;
        if(!sameEq(c.baseline,prep.current)){c.info.textContent='Mixer EQ changed since analysis. Automatic write skipped.';continue}
        c.info.textContent='Auto EQ: applying a gentle verified cut to CH'+n+'…';
        await bridge('/api/eq/apply','POST',{channel:n,nonce:prep.nonce,recommendations:[candidate],speed:'slow',ack:'CONFIRM_REAL_X32_EQ_WRITE'});
        let verified=false;
        for(let i=0;i<55;i++){
          if(g!==unifiedGeneration||unifiedMode!=='auto'){
            try{await bridge('/api/eq/stop','POST',{})}catch{}
            return;
          }
          await unifiedPause(1000);
          const state=await bridge('/api/eq/status?channel='+n),w=state.job||{};
          if(w.channel!==n)throw Error('Another X32 EQ write interrupted this channel');
          if(w.status==='verified'){verified=true;break;}
          if(['failed','stopped'].includes(w.status))throw Error(w.error||'Mixer did not verify EQ');
        }
        if(!verified)throw Error('No verified mixer EQ readback');
        unifiedWrites.set(n,(unifiedWrites.get(n)||0)+1);
        unifiedLastWrite.set(n,Date.now());
        c.info.textContent='✓ CH'+n+' automatic EQ verified on mixer (one gentle cut).';
      }catch(e){
        c.info.textContent='Auto EQ paused for CH'+n+': '+String(e.message||e);
        unifiedMode='idle';
        return;
      }
    }
  }finally{applying=false;updateOptions();}
}
async function unifiedCompleted(j){
  const g=unifiedGeneration;
  if(!['live','auto'].includes(unifiedMode))return;
  if(unifiedMode==='auto')await unifiedAutoPass(j.channels,g);
  unifiedSchedule(g);
}
window.X32UnifiedEngine={
  selected:()=>[...selected].sort((a,b)=>a-b),
  max:MAX,
  active:()=>unifiedMode,
  start:(kind,analysis)=>{
    if(!['check','live','auto'].includes(kind))throw Error('Invalid mode');
    if(!selected.size)throw Error('Select one or more microphones');
    if(job)stop();
    if(applying)throw Error('An EQ change is still finishing');
    clearTimeout(unifiedTimer);unifiedGeneration++;
    unifiedMode=kind;unifiedWrites.clear();unifiedLastWrite.clear();
    $('x32-multi-mode').value=analysis==='singing'?'singing':'speaking';
    cards.clear();$('x32-multi-results').replaceChildren();
    start();
  },
  stop:()=>{
    unifiedMode='idle';unifiedGeneration++;clearTimeout(unifiedTimer);stop();
    if(applying)bridge('/api/eq/stop','POST',{}).catch(()=>{});
  },
  busy:()=>!!job||applying
};
$('x32-multi-go').onclick=start;
$('x32-multi-stop').onclick=stop;
window.addEventListener('beforeunload',stop);
updateOptions();
})();
