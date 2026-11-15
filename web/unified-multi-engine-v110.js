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
      if(!c?.baseline||r?.voiceDetected!==true||r?.confidence!=='high'||r?.reviewComplete!==true||r?.channel!==n||!Array.isArray(r.suggestions))continue;
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