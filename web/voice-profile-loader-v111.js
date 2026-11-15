(()=>{'use strict';
const $=id=>document.getElementById(id),one=$('x32-one-ui'),engine=window.X32UnifiedEngine;
if(!one||!engine||$('x32-one-profile'))return;
const box=document.createElement('div');box.id='x32-one-profile';box.hidden=true;
box.innerHTML='<label for="x32-one-profile-list">Saved EQ starting point</label><select id="x32-one-profile-list"><option value="">No saved profile</option></select><button type="button" id="x32-one-profile-load">Load EQ</button><span id="x32-one-profile-status" role="status"></span>';
one.querySelector('.x32-one-room')?.before(box);
let profiles=[];
const picker=$('x32-one-profile-list'),button=$('x32-one-profile-load'),msg=$('x32-one-profile-status');
const say=text=>{msg.textContent=text;};
async function reload(){
 try{
  const r=await fetch('/api/voice-memory/profiles',{credentials:'same-origin',cache:'no-store'});
  const data=await r.json();
  if(!r.ok)throw Error(data.error||'Unable to read saved EQ profiles');
  profiles=Array.isArray(data.profiles)?data.profiles:[];
  if(!profiles.length){box.hidden=true;return;}
  const previous=picker.value||localStorage.getItem('x32-one-profile-chosen')||'';
  picker.replaceChildren();
  const opt=document.createElement('option');opt.value='';opt.textContent='Select saved profile';picker.append(opt);
  for(const p of profiles){
   const o=document.createElement('option');o.value=p.id;o.textContent=p.name+' · '+(p.mode==='speech'?'Speaking':'Singing');picker.append(o);
  }
  if(profiles.some(p=>p.id===previous))picker.value=previous;
  box.hidden=false;
 }catch(err){console.warn('Saved EQ profiles not ready:',err.message);}
}
picker.addEventListener('change',()=>{say('');try{localStorage.setItem('x32-one-profile-chosen',picker.value)}catch{}});
async function bridge(path,method='GET',body){
 const key=$('x32-key')?.value?.trim();
 if(!key)throw Error('Connect the Windows mixer bridge.');
 const r=await fetch('http://127.0.0.1:8792'+path,{method,
  headers:{'X-Bridge-Key':key,...(body?{'Content-Type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(16000)});
 const v=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(v.error||'Mixer bridge HTTP '+r.status);
 return v;
}
button.onclick=async()=>{
 if(button.disabled)return;
 const ids=engine.selected(),p=profiles.find(x=>x.id===picker.value);
 if(ids.length!==1){say('Select exactly one microphone before loading a saved EQ.');return}
 if(!p){say('Choose a saved profile.');return}
 if(engine.active()!=='idle'||engine.busy()){say('Press Stop before loading a preset.');return}
 const b=p.eq?.bands,hpf=p.eq?.hpf,n=ids[0];
 if(!Array.isArray(b)||b.length!==4||b.some(x=>!['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(x?.type)||
    !Number.isFinite(x.frequencyHz)||x.frequencyHz<20||x.frequencyHz>20000||
    !Number.isFinite(x.gainDb)||x.gainDb< -15||x.gainDb>15||
    !Number.isFinite(x.q)||x.q<.3||x.q>10)||
    !hpf||typeof hpf.on!=='boolean'||!Number.isFinite(hpf.frequencyHz)){
    say('Saved EQ settings are not compatible with the mixer bridge.');return
 }
 const prompt='Load saved EQ "'+p.name+'" onto physical X32 CH'+n+'?\n\nThis immediately changes four EQ bands and HPF for CH'+n+' only. The existing per-channel rollback snapshot is preserved. You can stop or restore if needed.\n\nContinue?';
 if(!window.confirm(prompt))return;
 button.disabled=true;
 try{
  say('Preparing verified X32 EQ readback…');
  const st=await bridge('/api/eq/status?channel='+n);
  if(st.writesEnabled!==true||!['EQ-CHANNELS-01-32-V8','AUTO-ROOM-POST-EQ-V109'].includes(st.bridgeVersion))throw Error('Updated verified Windows bridge required');
  const prep=await bridge('/api/eq/prepare?channel='+n);
  if(!prep?.nonce||prep?.current?.channel!==n)throw Error('Fresh EQ snapshot not available');
  const recommendations=b.map((x,i)=>({band:i+1,type:x.type,frequencyHz:x.frequencyHz,gainDb:x.gainDb,q:x.q}));
  say('Applying saved EQ to CH'+n+'…');
  await bridge('/api/eq/apply','POST',{channel:n,nonce:prep.nonce,
    recommendations,hpf:{on:hpf.on,frequencyHz:hpf.frequencyHz},
    speed:'aggressive',ack:'CONFIRM_REAL_X32_EQ_WRITE'});
  let verified=false;
  for(let i=0;i<75;i++){
   await new Promise(done=>setTimeout(done,900));
   const s=await bridge('/api/eq/status?channel='+n),j=s.job||{};
   if(j.channel!==n)throw Error('A different mixer operation took over');
   if(j.status==='verified'){verified=true;break}
   if(j.status==='failed'||j.status==='stopped')throw Error(j.error||'Mixer rejected EQ settings');
  }
  if(!verified)throw Error('EQ readback verification timed out');
  say('✓ '+p.name+' loaded and verified on CH'+n+'. Choose Check EQ to refine it.');
 }catch(err){say('Saved EQ not loaded: '+String(err.message||err))}
 finally{button.disabled=false}
};
reload();
})();